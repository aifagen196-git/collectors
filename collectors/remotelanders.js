import axios from "axios";
import { runCollector, getSupabase } from "./runtime.js";
import { normalizeBasic } from "./normalize/normalizeBasic.js";
import { isUsJob } from "./lib/isUsJob.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";

// Remote Landers (remotelanders.com), a remote-jobs board. No API for us:
// robots.txt disallows /api/ and filtered searches, but allows the job pages
// and publishes them in a sitemap. Each job page carries a schema.org
// JobPosting block (the data Google Jobs reads), which is what we parse.
//
// Each run: read the jobs sitemap, fetch only job pages we don't have yet
// (IT-looking slugs only, politely, capped per run), then hide stored jobs
// that are no longer in the sitemap.

const SITEMAP = "https://remotelanders.com/sitemaps/jobs.xml";
const UA = "AIFAGenJobCollector/1.0 (+https://aifagenlabs.com)";
const REQUEST_DELAY_MS = Number(process.env.REMOTELANDERS_DELAY_MS || 1000);
const MAX_NEW_PER_RUN = Number(process.env.REMOTELANDERS_MAX_NEW || 300);

const stats = {
  inSitemap: 0,
  alreadyStored: 0,
  offDomainSlug: 0,
  fetched: 0,
  pageFailed: 0,
  noJobPosting: 0,
  offDomain: 0,
  nonUs: 0,
  processed: 0,
  saved: 0,
  deduped: 0,
  failed: 0,
};

const http = axios.create({ timeout: 25000, headers: { "User-Agent": UA } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slugOf = (url) => url.split("/remote-jobs/")[1]?.replace(/\/$/, "") || "";

async function storedIds() {
  const ids = new Set();
  const sb = getSupabase();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("jobs")
      .select("source_job_id")
      .eq("source", "remotelanders")
      .eq("is_active", true)
      .range(from, from + 999);
    if (error) throw new Error(`stored-id lookup failed: ${error.message}`);
    for (const r of data) ids.add(r.source_job_id);
    if (data.length < 1000) return ids;
  }
}

function jobPostingFrom(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      if (j["@type"] === "JobPosting") return j;
    } catch {
      // ignore a malformed block and keep looking
    }
  }
  return null;
}

function locationOf(p) {
  const req = [].concat(p.applicantLocationRequirements || []).map((x) => x?.name).filter(Boolean);
  const places = [].concat(p.jobLocation || [])
    .map((l) => [l?.address?.addressLocality, l?.address?.addressRegion, l?.address?.addressCountry].filter(Boolean).join(", "))
    .filter(Boolean);
  const remote = p.jobLocationType === "TELECOMMUTE";
  if (remote && req.length) return `Remote (${req.join(", ")})`;
  return [...places, remote ? "Remote" : ""].filter(Boolean).join(" / ");
}

function salaryOf(p) {
  const v = p.baseSalary?.value;
  if (!v?.minValue) return null;
  const cur = p.baseSalary.currency || "";
  const unit = (v.unitText || "").toLowerCase();
  return `${cur} ${v.minValue}${v.maxValue ? `-${v.maxValue}` : ""}${unit ? ` per ${unit}` : ""}`.trim();
}

export default async function collectRemoteLandersJobs() {
  console.log("\n==========================================");
  console.log("🚀 Remote Landers Collector Started");
  console.log("==========================================\n");

  const { data: xml } = await http.get(SITEMAP);
  const urls = [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const slugs = urls.map(slugOf).filter(Boolean);
  stats.inSitemap = slugs.length;
  const listedIds = new Set(slugs);

  const have = await storedIds();
  const todo = [];
  for (const slug of slugs) {
    if (have.has(slug)) {
      stats.alreadyStored++;
      continue;
    }
    // The slug is "<title words>-<company words>-<id>"; a rough IT check here
    // avoids fetching pages we would throw away. The real title is checked again.
    if (!isDomainJob(slug.replace(/-/g, " "))) {
      stats.offDomainSlug++;
      continue;
    }
    todo.push(slug);
  }
  console.log(`📄 ${slugs.length} jobs in sitemap, ${have.size} stored, ${todo.length} new IT-looking to fetch (cap ${MAX_NEW_PER_RUN})`);

  const rows = [];
  for (const slug of todo.slice(0, MAX_NEW_PER_RUN)) {
    if (stats.fetched) await sleep(REQUEST_DELAY_MS);
    stats.fetched++;
    let html;
    try {
      ({ data: html } = await http.get(`https://remotelanders.com/remote-jobs/${slug}`));
    } catch (err) {
      stats.pageFailed++;
      if (err.response?.status === 429 || err.response?.status === 403) {
        console.error(`🚫 ${err.response.status} from Remote Landers, stopping this run`);
        break;
      }
      continue;
    }
    const p = jobPostingFrom(String(html));
    if (!p?.title) {
      stats.noJobPosting++;
      continue;
    }
    if (!isDomainJob(p.title)) {
      stats.offDomain++;
      continue;
    }
    const row = await normalizeBasic({
      source: "remotelanders",
      id: slug,
      title: p.title,
      company: p.hiringOrganization?.name,
      location: locationOf(p),
      descriptionHtml: p.description,
      applyUrl: `https://remotelanders.com/remote-jobs/${slug}`,
      postedDate: p.datePosted ? new Date(p.datePosted).toISOString() : undefined,
      employmentType: [].concat(p.employmentType || []).join(", "),
      salary: salaryOf(p),
      expiresAt: p.validThrough,
    });
    if (!isUsJob(row)) {
      stats.nonUs++;
      continue;
    }
    stats.processed++;
    rows.push(row);
  }

  const r = await saveJobs(rows, stats);
  console.log(`💾 saved ${r.saved}/${r.attempted}`);

  await deactivateMissing("remotelanders", listedIds);

  console.log("\n==========================================");
  console.log("✅ Remote Landers Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectRemoteLandersJobs);

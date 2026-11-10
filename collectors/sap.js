import axios from "axios";
import { runCollector } from "./runtime.js";
import { normalizeBasic } from "./normalize/normalizeBasic.js";
import { isUsJob } from "./lib/isUsJob.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";

// SAP careers (https://jobs.sap.com). Replaces successfactors.js: in 2026 SAP
// moved its site off SuccessFactors Career Site Builder (the old /search/
// pages now 403) to a SmartRecruiters-backed site.
//   GET /en/jobs/?page=N  -> 24 jobs per page, embedded in the page data as
//       {"id","title","url","teams","locations","displayDate",...}, plus
//       "totalJobs"
//   GET /en/jobs/{id}/{slug}/ -> JSON-LD JobPosting with the description
// Only US IT jobs get a detail fetch. Jobs that leave the listing are hidden.

const BASE = "https://jobs.sap.com";
const UA = "AIFAGenJobCollector/1.0 (+https://aifagenlabs.com)";
const PAGE_SIZE = 24;
const MAX_PAGES = 100;
const DELAY_MS = Number(process.env.SAP_DELAY_MS || 1000);

const stats = {
  pages: 0,
  listed: 0,
  offDomain: 0,
  nonUs: 0,
  detailFailed: 0,
  processed: 0,
  saved: 0,
  deduped: 0,
  failed: 0,
};

const http = axios.create({ timeout: 30000, headers: { "User-Agent": UA } });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// The page data is a JS string, so its quotes arrive escaped (\").
function parseListing(html) {
  const text = String(html).replace(/\\"/g, '"');
  const total = Number(text.match(/"totalJobs":(\d+)/)?.[1] || 0);
  const jobs = [];
  const re = /\{"id":"(\d+)","title":"((?:[^"\\]|\\.)*)","url":"([^"]+)"[^{}]*?"locations":"((?:[^"\\]|\\.)*)","displayDate":"([^"]*)"/g;
  for (const m of text.matchAll(re)) {
    jobs.push({ id: m[1], title: jsonUnescape(m[2]), url: m[3], location: jsonUnescape(m[4]), date: m[5] });
  }
  return { total, jobs };
}

function jsonUnescape(s) {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
}

function jobPosting(html) {
  for (const m of String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      const found = [].concat(j["@graph"] || j).find((o) => o?.["@type"] === "JobPosting");
      if (found) return found;
    } catch {
      // not JSON, try the next block
    }
  }
  return null;
}

export default async function collectSapJobs() {
  console.log("\n==========================================");
  console.log("🚀 SAP Collector Started");
  console.log("==========================================\n");

  const listed = [];
  let total = 0;
  let complete = true;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let parsed;
    try {
      const { data } = await http.get(`${BASE}/en/jobs/`, { params: page > 1 ? { page } : {} });
      parsed = parseListing(data);
    } catch (err) {
      console.error(`❌ page ${page}: ${err.response?.status || err.message}`);
      complete = false;
      break;
    }
    stats.pages++;
    if (page === 1) {
      total = parsed.total;
      if (!parsed.jobs.length) {
        throw new Error("No jobs found on the first page; the page layout may have changed");
      }
    }
    listed.push(...parsed.jobs);
    if (!parsed.jobs.length || page >= Math.ceil(total / PAGE_SIZE)) break;
    await delay(DELAY_MS);
  }
  // A job can show on two pages when the order shifts mid-run.
  const unique = [...new Map(listed.map((j) => [j.id, j])).values()];
  stats.listed = unique.length;
  if (total && unique.length < total * 0.9) complete = false;
  console.log(`📄 ${unique.length} of ${total} jobs listed over ${stats.pages} pages`);

  const candidates = unique.filter((job) => {
    if (!isDomainJob(job.title)) {
      stats.offDomain++;
      return false;
    }
    if (!isUsJob({ location: job.location })) {
      stats.nonUs++;
      return false;
    }
    return true;
  });

  const rows = [];
  for (const job of candidates) {
    await delay(DELAY_MS);
    let posting;
    try {
      const { data } = await http.get(`${BASE}${job.url}`);
      posting = jobPosting(data);
    } catch {
      posting = null;
    }
    if (!posting) {
      stats.detailFailed++;
      continue;
    }
    rows.push(
      await normalizeBasic({
        source: "sap",
        id: job.id,
        title: job.title,
        company: "SAP",
        location: job.location,
        descriptionHtml: posting.description || "",
        applyUrl: `${BASE}${job.url}`,
        postedDate: job.date || posting.datePosted || undefined,
        employmentType: posting.employmentType || "",
        expiresAt: posting.validThrough,
      }),
    );
    stats.processed++;
  }

  await saveJobs(rows, stats);

  if (complete) {
    await deactivateMissing("sap", new Set(listed.map((j) => j.id)));
  } else {
    console.log("⏭ Skipping deactivation: the listing did not load completely");
  }

  console.log("\n==========================================");
  console.log("✅ SAP Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectSapJobs);

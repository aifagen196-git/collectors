import axios from "axios";
import { runCollector } from "./runtime.js";
import { normalizeBasic } from "./normalize/normalizeBasic.js";
import { isUsJob } from "./lib/isUsJob.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";

// Authentic Jobs (authenticjobs.com), a design and development jobs board on
// WordPress. The site's pages sit behind Cloudflare's bot check, but its
// public WordPress REST API answers a plainly named client:
//   GET /wp-json/wp/v2/job-listings?per_page=100&page=N
// Each listing carries company, location, apply link and a "filled" flag in
// `meta`. A small board (44 listings on 2026-11-04), so every run re-saves
// all open IT listings and hides the ones that are gone or filled.

const API = "https://authenticjobs.com/wp-json/wp/v2/job-listings";
const UA = "AIFAGenJobCollector/1.0 (+https://aifagenlabs.com)";
const MAX_PAGES = 20;

const stats = {
  listed: 0,
  filled: 0,
  offDomain: 0,
  nonUs: 0,
  processed: 0,
  saved: 0,
  deduped: 0,
  failed: 0,
};

const decode = (s) =>
  String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

async function fetchAll() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await axios.get(API, {
      timeout: 25000,
      headers: { "User-Agent": UA },
      params: { per_page: 100, page },
      validateStatus: (s) => s === 200 || s === 400, // 400 = past the last page
    });
    if (res.status === 400 || !Array.isArray(res.data) || !res.data.length) break;
    all.push(...res.data);
    const totalPages = Number(res.headers["x-wp-totalpages"]) || 1;
    if (page >= totalPages) break;
  }
  return all;
}

export default async function collectAuthenticJobs() {
  console.log("\n==========================================");
  console.log("🚀 Authentic Jobs Collector Started");
  console.log("==========================================\n");

  const listings = await fetchAll();
  stats.listed = listings.length;

  const listedIds = new Set();
  const rows = [];
  for (const job of listings) {
    const meta = job.meta || {};
    if (Number(meta._filled) === 1) {
      stats.filled++;
      continue; // left out of listedIds, so a stored copy gets hidden
    }
    listedIds.add(String(job.id));

    const title = decode(job.title?.rendered);
    if (!isDomainJob(title)) {
      stats.offDomain++;
      continue;
    }
    const remote = Number(meta._remote_position) === 1;
    const location = [decode(meta._job_location), remote ? "Remote" : ""].filter(Boolean).join(" / ");
    const salary = meta._job_salary
      ? `${meta._job_salary_currency || ""} ${meta._job_salary}${meta._job_salary_unit ? ` per ${meta._job_salary_unit}` : ""}`.trim()
      : null;

    const row = await normalizeBasic({
      source: "authenticjobs",
      id: job.id,
      title,
      company: decode(meta._company_name),
      location,
      descriptionHtml: job.content?.rendered,
      // The employer's own apply page when given (often Greenhouse/Lever),
      // else the listing.
      applyUrl: /^https?:\/\//.test(meta._application || "") ? meta._application : job.link,
      postedDate: job.date_gmt ? new Date(`${job.date_gmt}Z`).toISOString() : undefined,
      salary,
    });
    if (!isUsJob(row)) {
      stats.nonUs++;
      continue;
    }
    stats.processed++;
    rows.push(row);
  }

  const r = await saveJobs(rows, stats);
  console.log(`💾 saved ${r.saved}/${r.attempted} of ${listings.length} listings`);

  await deactivateMissing("authenticjobs", listedIds);

  console.log("\n==========================================");
  console.log("✅ Authentic Jobs Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectAuthenticJobs);

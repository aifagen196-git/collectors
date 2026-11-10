import axios from "axios";
import { getSupabase, runCollector } from "./runtime.js";
import { normalizeBasic } from "./normalize/normalizeBasic.js";
import { isUsJob } from "./lib/isUsJob.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import targetDomains from "../config/targetDomains.js";
import { saveJobs, deactivateStale } from "../processors/saveJobs.js";

// Workable, through the public JSON feed behind jobs.workable.com (Workable's
// own job search across every company that hires with Workable):
//   GET https://jobs.workable.com/api/v1/jobs?query=..&location=United States
//       [&pageToken=..] -> {totalSize, nextPageToken, jobs: [{id, title,
//       description, requirementsSection, benefitsSection, url, location,
//       locations, created, company: {title}, employmentType, workplace}]}
// No key and no browser. This replaced a Playwright scraper of individual
// company boards (2026-11-10): that list had gone stale (5 of 251 boards had
// jobs) and the per-board API was rate-limiting us.
//
// The feed has a daily request quota: after ~380 pages in one day it answered
// 429 with Retry-After: 86400. So this runs at most once every
// MIN_INTERVAL_HOURS (the schedule calls it every 6h; the other calls return
// at once), spends at most PAGE_BUDGET pages split across the searches, and
// stops on a long Retry-After instead of waiting it out. Jobs no search has
// returned for STALE_HOURS are hidden.

const API = "https://jobs.workable.com/api/v1/jobs";
const UA = "AIFAGenJobCollector/1.0 (+https://aifagenlabs.com)";
const DELAY_MS = Number(process.env.WORKABLE_DELAY_MS || 1500);
const PAGE_BUDGET = Number(process.env.WORKABLE_PAGE_BUDGET || 250); // 20 jobs a page
const MAX_PAGES = Math.ceil(PAGE_BUDGET / targetDomains.length);
const MAX_RETRY_WAIT_S = 120;
const MIN_INTERVAL_HOURS = Number(process.env.WORKABLE_MIN_INTERVAL_HOURS || 20);
const STALE_HOURS = Number(process.env.WORKABLE_STALE_HOURS || 72);

class RateLimited extends Error {}

const stats = {
  searches: 0,
  pages: 0,
  listed: 0,
  offDomain: 0,
  nonUs: 0,
  processed: 0,
  saved: 0,
  deduped: 0,
  failed: 0,
};

const http = axios.create({ timeout: 30000, headers: { "User-Agent": UA } });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPage(params) {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await http.get(API, { params })).data;
    } catch (err) {
      if (err.response?.status === 429) {
        const waitS = Number(err.response.headers?.["retry-after"]) || 30 * (attempt + 1);
        if (waitS > MAX_RETRY_WAIT_S || attempt >= 3) {
          throw new RateLimited(`rate-limited (Retry-After ${waitS}s)`);
        }
        console.log(`   ⏳ rate-limited, waiting ${waitS}s`);
        await delay(waitS * 1000);
        continue;
      }
      throw err;
    }
  }
}

// Every job for one search, up to MAX_PAGES (results are sorted by
// relevance, so a capped search keeps its best matches).
async function searchAll(query) {
  const jobs = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await getPage({ query, location: "United States", ...(pageToken ? { pageToken } : {}) });
    stats.pages++;
    jobs.push(...(data.jobs || []));
    pageToken = data.nextPageToken;
    if (!pageToken || !data.jobs?.length) return jobs;
    await delay(DELAY_MS);
  }
  console.log(`   ⚠ "${query}": stopped at ${MAX_PAGES} pages`);
  return jobs;
}

const locationOf = (job) =>
  (job.locations?.length
    ? job.locations
    : [[job.location?.city, job.location?.subregion, job.location?.countryName].filter(Boolean).join(", ")]
  )
    .filter(Boolean)
    .join(" / ");

export default async function collectWorkableJobs() {
  console.log("\n==========================================");
  console.log("🚀 Workable Collector Started");
  console.log("==========================================\n");

  const since = new Date(Date.now() - MIN_INTERVAL_HOURS * 3600 * 1000).toISOString();
  const { data: recent } = await getSupabase()
    .from("collector_runs")
    .select("started_at")
    .eq("source", "workable")
    .eq("success", true)
    .gt("saved", 0)
    .gte("started_at", since)
    .limit(1);
  if (recent?.length) {
    console.log(`⏭ Last successful run ${recent[0].started_at}; runs at most every ${MIN_INTERVAL_HOURS}h (daily quota)`);
    return { saved: 0, failed: 0 };
  }

  const byId = new Map();
  let complete = true;

  for (const query of targetDomains) {
    stats.searches++;
    let jobs;
    try {
      jobs = await searchAll(query);
    } catch (err) {
      console.error(`❌ "${query}": ${err.response?.status || err.message}`);
      complete = false;
      if (err instanceof RateLimited) break;
      continue;
    }
    console.log(`🔎 "${query}": ${jobs.length} jobs`);
    for (const j of jobs) byId.set(j.id, j);
    await delay(DELAY_MS);
  }
  stats.listed = byId.size;

  const rows = [];
  for (const job of byId.values()) {
    if (!isDomainJob(job.title)) {
      stats.offDomain++;
      continue;
    }
    const row = await normalizeBasic({
      source: "workable",
      id: job.id,
      title: job.title,
      company: job.company?.title || "",
      location: locationOf(job) || (job.workplace === "remote" ? "Remote, United States" : ""),
      descriptionHtml: [job.description, job.requirementsSection, job.benefitsSection].filter(Boolean).join("\n"),
      applyUrl: job.url,
      postedDate: job.created || undefined,
      employmentType: job.employmentType || "",
    });
    if (!row.company || !isUsJob(row)) {
      stats.nonUs++;
      continue;
    }
    stats.processed++;
    rows.push(row);
  }

  await saveJobs(rows, stats);

  // A broad search can run past MAX_PAGES, so the results aren't always the
  // full set. Hide jobs no search has returned for STALE_HOURS instead of
  // ones missing from this run.
  if (complete) {
    await deactivateStale("workable", STALE_HOURS);
  } else {
    console.log("⏭ Skipping deactivation: a search failed");
  }

  console.log("\n==========================================");
  console.log("✅ Workable Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectWorkableJobs);

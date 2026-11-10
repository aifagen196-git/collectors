import httpClient from "../utils/httpClient.js";
import { getSupabase, runCollector } from "./runtime.js";
import { normalizeJob } from "../processors/normalizeJobs.js";
import companies from "../config/greenhouseCompanies.js";
import runPool from "../processors/workerPool.js";
import withRetry from "../processors/retry.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";
import normalizeCompany from "../processors/companyNormalizer.js";
import {
  resolveCompanyName,
  persistCompanyCache,
} from "../processors/companyEnrichment.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { isUsJob, usFromLocation } from "./lib/isUsJob.js";

// =============================================
// CONFIG
// =============================================

// A stored job is fetched again only if Greenhouse updated it this recently.
const SCRAPE_LAST_HOURS = Number(process.env.SCRAPE_LAST_HOURS || 24);
// Parallel detail-page fetches per company. Greenhouse tolerates this well and
// it is the difference between a ~7-hour run and a ~20-minute one.
const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 8);

// =============================================
// STATS
// =============================================

const stats = {
  companies: 0,
  boardsFailed: 0,
  fetched: 0,
  offDomain: 0,
  nonUs: 0,
  unchanged: 0,
  processed: 0,
  saved: 0,
  deduped: 0,
  failed: 0,
};

// =============================================
// FETCH COMPANY JOBS
// =============================================

async function fetchCompanyJobs(company) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`;

    const response = await withRetry(() => httpClient.get(url));

    return response.data.jobs || [];
  } catch (err) {
    console.error(`❌ Failed to fetch ${company}`);
    // null, not []: a board that failed to load must not look like a board
    // whose jobs all closed (see deactivateMissing below).
    return null;
  }
}

// =============================================
// FETCH JOB DETAILS
// =============================================

async function fetchJobDetails(company, jobId) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}`;

    const response = await withRetry(() => httpClient.get(url));

    return response.data;
  } catch (err) {
    console.error(`❌ Failed details ${company}/${jobId}`);
    return null;
  }
}

// What is already stored for this source: whether each job is live, and
// whether it is in the US by its stored fields (set from the full description
// when it was saved). Lets a run skip the detail fetch for jobs it already has.
async function loadStored() {
  const stored = new Map();
  const sb = getSupabase();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("jobs")
      .select("source_job_id, is_active, location, country, is_remote_us")
      .eq("source", "greenhouse")
      .order("id")
      .range(from, from + 999);
    if (error) {
      // Without it every IT job gets its details fetched: slower, still right.
      console.error(`⚠ Stored-job lookup failed: ${error.message}`);
      return new Map();
    }
    for (const r of data) {
      stored.set(String(r.source_job_id), { active: r.is_active, us: isUsJob(r) });
    }
    if (data.length < 1000) break;
  }
  return stored;
}

// =============================================
// MAIN
// =============================================

export default async function collectGreenhouseJobs() {
  console.log("\n==========================================");
  console.log("🚀 Greenhouse Collector Started");
  console.log("==========================================\n");

  const cutoff = new Date(Date.now() - SCRAPE_LAST_HOURS * 60 * 60 * 1000);
  const stored = await loadStored();

  // Every posting listed this run (`listed`), the ones that stay live
  // (`keptIds`: IT and in the US), and the boards that failed to load. The
  // pass at the end hides stored jobs that left a board that did load, or
  // that no longer pass the filters.
  const listed = new Set();
  const keptIds = new Set();
  const failedCompanies = new Set();

  for (const company of companies) {
    try {
      stats.companies++;

      const jobs = await fetchCompanyJobs(company);
      if (jobs === null) {
        stats.boardsFailed++;
        const name = await resolveCompanyName(company, "greenhouse");
        failedCompanies.add(normalizeCompany(name) || name);
        continue;
      }
      for (const job of jobs) listed.add(String(job.id));

      stats.fetched += jobs.length;

      // The list gives title, location and updated_at. Decide what it can
      // here, and fetch details only for IT jobs that are new, were updated,
      // or have a location that doesn't say where they are ("Remote").
      const toFetch = [];
      for (const job of jobs) {
        const id = String(job.id);
        if (!isDomainJob(job.title)) {
          stats.offDomain++;
          continue;
        }
        const us = usFromLocation(job.location?.name);
        const prev = stored.get(id);
        if (us === false || (us === null && prev && !prev.us)) {
          stats.nonUs++;
          continue;
        }
        if (prev?.active && new Date(job.updated_at) < cutoff) {
          keptIds.add(id);
          stats.unchanged++;
          continue;
        }
        toFetch.push({ job, us, prev });
      }

      // Store the employer's real display name ("Scale AI"), not the board
      // slug ("scaleai") — the slug is what users were seeing on job cards.
      // Cached on disk, so this is one request per board per month.
      const displayName = await resolveCompanyName(company, "greenhouse");

      console.log(
        `\n🏢 ${displayName} (${jobs.length} jobs, ${toFetch.length} to fetch)`,
      );
      if (!toFetch.length) continue;

      // Detail fetches are independent — run them with a bounded worker pool
      // instead of one-at-a-time (the old loop made ~10k sequential requests).
      const results = await runPool(
        toFetch,
        async ({ job, us, prev }) => {
          const id = String(job.id);
          const details = await fetchJobDetails(company, job.id);
          if (!details) {
            stats.failed++;
            // Still listed; a live stored copy stays live.
            if (prev?.active) keptIds.add(id);
            return null;
          }
          const row = await normalizeJob(job, displayName, details);
          // A US city named without its state ("San Francisco") counts.
          if (us !== true && !isUsJob(row)) {
            stats.nonUs++;
            return null;
          }
          stats.processed++;
          keptIds.add(id);
          return row;
        },
        DETAIL_CONCURRENCY,
      );
      // saveJobs de-duplicates, chunks, and reports what actually landed —
      // the old log printed a success count even when the upsert had failed.
      const r = await saveJobs(results.filter(Boolean), stats);
      if (r.deduped) console.log(`   🧹 ${r.deduped} duplicate(s) collapsed`);
      if (r.attempted) console.log(`   💾 saved ${r.saved}/${r.attempted}`);
    } catch (err) {
      console.error(`\n❌ Company failed: ${company}`);

      console.error(err.message);
    }
  }

  persistCompanyCache();

  // Retire only OUR postings. This pass previously had no source filter, so
  // one Greenhouse run deactivated every job in the table that any other
  // collector had not refreshed within the window.
  await deactivateMissing("greenhouse", keptIds, failedCompanies, { listed });

  console.log("\n==========================================");
  console.log("✅ Greenhouse Collector Finished");
  console.log("==========================================");

  console.table(stats);

  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectGreenhouseJobs);

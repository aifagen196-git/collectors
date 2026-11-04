import axios from "axios";
import { withRunLog } from "./runLog.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { normalizeFindwork } from "./normalize/normalizeFindwork.js";
import searches from "./config/findworkSearches.js";
import { isUsJob } from "./lib/isUsJob.js";

dotenv.config({ path: ".env" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================
// CONFIG
// =============================================
//
// Findwork.dev API — smaller tech/remote-focused aggregator, free key
// after signup (the key is on https://findwork.dev/developers/ when signed
// in). Auth is `Authorization: Token <key>`. The response fields used in
// normalizeFindwork.js were checked against a real authenticated response
// on 2026-11-04. Set FINDWORK_API_KEY in .env (GitHub secret for the cron).

const FINDWORK_API_KEY = process.env.FINDWORK_API_KEY;

const SCRAPE_LAST_HOURS = Number(process.env.SCRAPE_LAST_HOURS || 24);
const REQUEST_DELAY_MS = Number(process.env.FINDWORK_REQUEST_DELAY_MS || 6000);
const MAX_REQUESTS_PER_RUN = Number(process.env.FINDWORK_MAX_REQUESTS_PER_RUN || 60);

const ONLY_QUERIES = (process.env.ONLY_QUERIES || "")
  .split(",")
  .map((q) => q.trim().toLowerCase())
  .filter(Boolean);

const selectedSearches = ONLY_QUERIES.length
  ? searches.filter(({ search }) => ONLY_QUERIES.some((q) => search.toLowerCase().includes(q)))
  : searches;

const MAX_RESULTS_TOTAL = Number(process.env.FINDWORK_MAX_RESULTS || 0);

// =============================================
// STATS
// =============================================

const stats = {
  searches: 0,
  requestsUsed: 0,
  fetched: 0,
  skippedDuplicate: 0,
  processed: 0,
  saved: 0,
  failed: 0,
  nonUs: 0,
  skippedNonIt: 0,
};

const NON_IT_PUBLISHERS = new Set(["coroflot", "dribbble"]);

// =============================================
// SAVE JOBS
// =============================================

// Findwork descriptions are long (whole Hacker News posts), and 200 of them
// in one upsert timed out on the description search index (2026-11-04). So
// batches are small, and a batch that still times out is split in half and
// retried.
async function saveBatch(batch) {
  const { error } = await supabase
    .from("jobs")
    .upsert(batch, { onConflict: "source,source_job_id" });
  if (!error) {
    stats.saved += batch.length;
    return;
  }
  if (/statement timeout/i.test(error.message) && batch.length > 5) {
    const mid = Math.ceil(batch.length / 2);
    await saveBatch(batch.slice(0, mid));
    await saveBatch(batch.slice(mid));
    return;
  }
  stats.failed += batch.length;
  console.error(`❌ batch of ${batch.length} failed: ${error.message}`);
}

async function saveJobs(jobs) {
  if (!jobs.length) return;
  const CHUNK = Number(process.env.SAVE_CHUNK || 50);
  for (let i = 0; i < jobs.length; i += CHUNK) {
    await saveBatch(jobs.slice(i, i + CHUNK));
  }
}

// =============================================
// FETCH
// =============================================

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Findwork throttles hard: 5 quick requests got a 429 with "Retry-After: 19"
// (2026-11-04). So every request waits REQUEST_DELAY_MS, and a 429 waits for
// the time Findwork asks for and tries again, up to MAX_429_RETRIES times.
const MAX_429_RETRIES = 4;

async function fetchPage(search, url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchPageOnce(search, url);
    } catch (err) {
      if (err.response?.status !== 429 || attempt >= MAX_429_RETRIES) throw err;
      const waitS = Math.min(Number(err.response.headers?.["retry-after"]) || 30, 120);
      console.log(`   ⏳ throttled, waiting ${waitS}s`);
      await sleep((waitS + 1) * 1000);
    }
  }
}

async function fetchPageOnce(search, url) {
  const { data } = await axios.get(url || "https://findwork.dev/api/jobs/", {
    timeout: 20000,
    headers: { Authorization: `Token ${FINDWORK_API_KEY}` },
    // No location param: Findwork matches it against free text, so
    // "United States" returned 2 of 173 devops jobs (2026-11-04) and missed
    // "Remote (US Only)", "Jacksonville, FL" and the like. isUsJob() below
    // does the US check instead.
    params: url ? undefined : { search },
  });

  return {
    results: data?.results || [],
    count: Number(data?.count) || 0,
    next: data?.next || null,
  };
}

// =============================================
// MAIN
// =============================================

async function run() {
  console.log("\n==========================================");
  console.log("🚀 Findwork Collector Started");
  console.log("==========================================\n");

  if (!FINDWORK_API_KEY) {
    console.error("❌ Missing FINDWORK_API_KEY in .env — aborting");
    console.error("   Register at https://findwork.dev (free).");
    return { skipped: "FINDWORK_API_KEY not set" };
  }

  if (ONLY_QUERIES.length) {
    console.log(`⚙ ONLY_QUERIES active — ${selectedSearches.length} of ${searches.length} searches\n`);
  }

  const seen = new Set();
  const normalized = [];

  outer: for (const { search } of selectedSearches) {
    stats.searches++;
    console.log(`\n🔎 "${search}"`);

    let nextUrl = null;
    let page = 0;
    do {
      page++;
      if (stats.requestsUsed >= MAX_REQUESTS_PER_RUN) {
        console.log(`\n⏸ Hit the ${MAX_REQUESTS_PER_RUN}-request budget for this run (FINDWORK_MAX_REQUESTS_PER_RUN) — stopping here to protect quota.`);
        break outer;
      }

      let result;
      try {
        if (stats.requestsUsed > 0) await sleep(REQUEST_DELAY_MS);
        stats.requestsUsed++;
        result = await fetchPage(search, nextUrl);
      } catch (err) {
        const status = err.response?.status;
        if (status === 401) {
          console.error("🚫 Findwork rejected the API key (401) — check FINDWORK_API_KEY. Stopping.");
          break outer;
        }
        if (status === 429) {
          console.error("🚫 Still rate limited by Findwork after retries — stopping.");
          break outer;
        }
        console.error(`❌ Page ${page} failed: ${status || err.message}`);
        break;
      }

      stats.fetched += result.results.length;
      console.log(`   page ${page}: ${result.results.length} results (of ${result.count} total)`);

      for (const job of result.results) {
        const id = String(job.id);
        if (seen.has(id)) {
          stats.skippedDuplicate++;
          continue;
        }
        seen.add(id);

        // Hacker News posts can come without a role (saved with a blank
        // title), and Coroflot/Dribbble list design and mechanical jobs
        // that Findwork's loose search still returns for IT keywords.
        if (!String(job.role || "").trim() || NON_IT_PUBLISHERS.has(String(job.source || "").toLowerCase())) {
          stats.skippedNonIt++;
          continue;
        }

        const normalizedJob = await normalizeFindwork(job);
        if (!isUsJob(normalizedJob)) {
          stats.nonUs++;
          continue;
        }
        normalized.push(normalizedJob);
        stats.processed++;

        if (MAX_RESULTS_TOTAL && normalized.length >= MAX_RESULTS_TOTAL) {
          console.log(`\n⏸ Hit FINDWORK_MAX_RESULTS (${MAX_RESULTS_TOTAL}) — stopping here.`);
          break outer;
        }
      }

      nextUrl = result.next;
    } while (nextUrl);
  }

  await saveJobs(normalized);
  console.log(`\n💾 saved ${stats.saved} / ${normalized.length}`);

  // =============================================
  // DEACTIVATE STALE JOBS
  // =============================================

  if (ONLY_QUERIES.length || MAX_RESULTS_TOTAL) {
    console.log("⏭ Skipping deactivation pass (partial run — rows carry no per-query column to scope it safely)");
  } else {
    const staleCutoff = new Date(Date.now() - SCRAPE_LAST_HOURS * 60 * 60 * 1000).toISOString();
    const { error: deErr, count } = await supabase
      .from("jobs")
      .update({ is_active: false })
      .lt("last_seen", staleCutoff)
      .eq("source", "findwork")
      .eq("is_active", true)
      .select("id", { count: "exact", head: true });
    if (deErr) console.error(`⚠ Deactivation pass failed: ${deErr.message}`);
    else console.log(`🗑 Deactivated ${count ?? 0} stale jobs`);
  }

  console.log("\n==========================================");
  console.log("✅ Findwork Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  // Lets withRunLog record the failed count, so a run whose save failed no
  // longer looks like a clean run that found nothing.
  return { saved: stats.saved, failed: stats.failed };
}

// CLI-only guard — this file used to call run() unconditionally at
// import time, which meant `import()`-ing it for any reason (a test
// harness, a future registry, etc.) triggered a real scrape/save run as a
// side effect. Only run when invoked directly (node collectors/findwork.js),
// matching every other collector in this repo (see runtime.js).
const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  withRunLog("findwork", run);
}

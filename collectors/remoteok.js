import axios from "axios";
import { withRunLog } from "./runLog.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { normalizeRemoteOkJob } from "./normalize/normalizeRemoteok.js";
import { isUsJob } from "./lib/isUsJob.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { deactivateWhere } from "../processors/saveJobs.js";
import allowedCompanies from "./config/remoteokCompanies.js";

dotenv.config({ path: ".env" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================
// CONFIG
// =============================================

const SCRAPE_LAST_HOURS = Number(process.env.SCRAPE_LAST_HOURS || 24);

// =============================================
// STATS
// =============================================

const stats = {
  fetched: 0,
  skipped: 0,
  processed: 0,
  saved: 0,
  failed: 0,
  nonUs: 0,
  offAllowlist: 0,
};

// Empty allowlist = no filtering (default). Case-insensitive exact match on
// the company name, since that's all these aggregator jobs give us — there's
// no stable per-company slug to key off like the ATS collectors have.
const ALLOWED_COMPANIES = new Set(
  allowedCompanies.map((c) => c.trim().toLowerCase()),
);

// The company allowlist alone dropped ~95% of the feed (94 of 99 on
// 2026-10-06), including real employers. Jobs from other companies are kept
// too when the title is in one of the site's areas of interest — spam
// postings rarely carry a real engineering/analyst title.
const RELEVANT_TITLE = new RegExp(
  [
    "devops", "site reliability", "\\bsre\\b", "platform engineer", "cloud",
    "supply chain", "logistics", "procurement",
    "machine learning", "\\bml\\b", "\\bai\\b", "data scien", "data engineer", "data analyst", "analytics",
    "data cent(?:er|re)", "network", "business analyst",
    "full[- ]?stack", "software", "developer", "engineer", "frontend", "front[- ]end", "backend", "back[- ]end",
    "\\bqa\\b", "quality", "test automation", "\\bsdet\\b",
    "it support", "help ?desk", "service desk", "desktop support", "\\bsap\\b",
  ].join("|"),
  "i",
);

// =============================================
// SAVE JOBS
// =============================================

async function saveJobs(jobs) {
  if (!jobs.length) return;
  const CHUNK = 500;
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const batch = jobs.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("jobs")
      .upsert(batch, { onConflict: "source,source_job_id" });
    if (error) {
      stats.failed += batch.length;
      console.error(`❌ batch of ${batch.length} failed: ${error.message}`);
      continue;
    }
    stats.saved += batch.length;
  }
}

// =============================================
// FETCH JOBS
// =============================================

/**
 * RemoteOK's /api endpoint is undocumented but widely used and stable.
 * It 403s without a browser-like User-Agent, so we send one. The first
 * element of the response array is a metadata legal notice, not a job.
 */
async function fetchJobs() {
  const { data } = await axios.get("https://remoteok.com/api", {
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!Array.isArray(data)) return [];

  return data.filter((job) => job && job.id && job.position);
}

// =============================================
// MAIN
// =============================================

async function run() {
  console.log("\n==========================================");
  console.log("🚀 RemoteOK Collector Started");
  console.log("==========================================\n");

  let jobs = [];
  try {
    jobs = await fetchJobs();
  } catch (err) {
    console.error(`❌ Failed to fetch RemoteOK jobs: ${err.message}`);
  }

  stats.fetched = jobs.length;
  console.log(`📥 ${jobs.length} jobs fetched`);

  const normalized = [];
  for (const job of jobs) {
    if (
      ALLOWED_COMPANIES.size &&
      !ALLOWED_COMPANIES.has(String(job.company || "").trim().toLowerCase()) &&
      !RELEVANT_TITLE.test(String(job.position || ""))
    ) {
      stats.offAllowlist++;
      continue;
    }

    console.log(`➡ ${job.position} @ ${job.company}`);

    const normalizedJob = await normalizeRemoteOkJob(job);
    if (!isDomainJob(normalizedJob.title)) {
      stats.offDomain = (stats.offDomain || 0) + 1;
      continue;
    }
    if (!isUsJob(normalizedJob)) {
      stats.nonUs++;
      continue;
    }
    normalized.push(normalizedJob);
    stats.processed++;
  }

  await saveJobs(normalized);
  if (normalized.length) console.log(`   💾 saved ${normalized.length}`);

  // =============================================
  // DEACTIVATE STALE JOBS
  // =============================================

  const staleCutoff = new Date(
    Date.now() - SCRAPE_LAST_HOURS * 60 * 60 * 1000,
  ).toISOString();

  // Batched (shared helper): one UPDATE over thousands of rows trips the
  // statement timeout.
  const { done: count, error: deErr } = await deactivateWhere((q) =>
    q.lt("last_seen", staleCutoff).eq("source", "remoteok"),
  );
  if (deErr) {
    console.error(`⚠ Deactivation failed after ${count} rows: ${deErr}`);
  } else {
    console.log(`🗑 Deactivated ${count} stale jobs`);
  }

  console.log("\n==========================================");
  console.log("✅ RemoteOK Collector Finished");
  console.log("==========================================");

  console.table(stats);

  console.log("==========================================\n");
}

// CLI-only guard — this file used to call run() unconditionally at
// import time, which meant `import()`-ing it for any reason (a test
// harness, a future registry, etc.) triggered a real scrape/save run as a
// side effect. Only run when invoked directly (node collectors/remoteok.js),
// matching every other collector in this repo (see runtime.js).
const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  withRunLog("remoteok", run);
}

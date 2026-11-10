import httpClient from "../utils/httpClient.js";
import { getSupabase, runCollector } from "./runtime.js";
import { normalizeLever } from "../processors/normalizeLever.js";
import companies from "../config/leverCompanies.js";
import withRetry from "../processors/retry.js";
import normalizeCompany from "../processors/companyNormalizer.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { isUsJob } from "./lib/isUsJob.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";

// Every open US IT job on each board is saved each run, and jobs that leave a
// board are hidden at the end. Until 2026-11-10 only jobs posted in the last
// 24 hours were kept (so most open jobs never showed), and there was no US
// filter.

// =============================================
// STATS
// =============================================

const stats = {
  companies: 0,
  fetched: 0,
  skipped: 0,
  processed: 0,
  inserted: 0,
  updated: 0,
  failed: 0,
};

// =============================================
// FETCH COMPANY JOBS
// =============================================

async function fetchCompanyJobs(company) {
  try {
    const url = `https://api.lever.co/v0/postings/${company}`;

    const { data } = await withRetry(() =>
      httpClient.get(url, {
        timeout: 15000,
        params: {
          mode: "json",
        },
      }),
    );

    return data || [];
  } catch (err) {
    console.error(`❌ Failed to fetch ${company}`);

    return null; // unlike [], tells the caller not to hide this board's jobs
  }
}

// =============================================
// MAIN
// =============================================

export default async function collectLeverJobs() {
  console.log("\n==========================================");
  console.log("🚀 Lever Collector Started");
  console.log("==========================================\n");

  // Every posting listed, and the ones that pass the filters (IT, US): jobs
  // still listed but filtered out are hidden too.
  const listed = new Set();
  const listedIds = new Set();
  const failedCompanies = new Set();

  for (const company of companies) {
    try {
      stats.companies++;

      const jobs = await fetchCompanyJobs(company);
      if (!Array.isArray(jobs)) {
        failedCompanies.add(normalizeCompany(company) || company);
        continue;
      }
      for (const job of jobs) listed.add(String(job.id));

      stats.fetched += jobs.length;

      console.log(`\n🏢 ${company.toUpperCase()} (${jobs.length} jobs)`);

      const normalized = [];
      for (const job of jobs) {
        if (!isDomainJob(job.text)) {
          stats.skipped++;
          continue;
        }

        const row = await normalizeLever(job, company);
        // Lever's own country code covers postings whose location text has no
        // state ("San Francisco").
        if (!isUsJob(row) && job.country !== "US") {
          stats.skipped++;
          continue;
        }

        listedIds.add(String(job.id));
        normalized.push(row);
        stats.processed++;
      }

      const r = await saveJobs(normalized, stats);
      if (r.deduped) console.log(`   🧹 ${r.deduped} duplicate(s) collapsed`);
      if (r.attempted) console.log(`   💾 saved ${r.saved}/${r.attempted}`);
    } catch (err) {
      console.error(`\n❌ Company failed: ${company}`);

      console.error(err.message);
      failedCompanies.add(normalizeCompany(company) || company);
    }
  }

  // =============================================
  // DEACTIVATE JOBS NO LONGER LISTED
  // =============================================

  await deactivateMissing("lever", listedIds, failedCompanies, { listed });

  console.log("\n==========================================");
  console.log("✅ Lever Collector Finished");
  console.log("==========================================");

  console.table(stats);

  console.log("==========================================\n");
}

runCollector(import.meta.url, collectLeverJobs);

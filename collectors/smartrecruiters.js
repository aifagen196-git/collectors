import httpClient from "../utils/httpClient.js";
import { runCollector } from "./runtime.js";
import { normalizeSmartRecruiters } from "../processors/normalizeSmartRecruiters.js";
import companies from "../config/smartrecruitersCompanies.js";
import runPool from "../processors/workerPool.js";
import withRetry from "../processors/retry.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";

// SmartRecruiters public postings API, no key:
//   GET https://api.smartrecruiters.com/v1/companies/{company}/postings
//       ?country=us&limit=100&offset=N  -> {content: [{id, name, ref, ...}]}
//   GET {ref}                           -> full posting
// Only US postings are listed, and details are fetched only for IT titles.
// Every open US IT job is saved each run, and jobs that leave the listings are
// hidden at the end.
//
// Until 2026-11-10 this fetched the details of every posting in every
// country, then kept only US jobs posted in the last 24 hours (51 live jobs;
// 271 were open). Only ~43 of the companies in the list hire in the US.

const DETAIL_CONCURRENCY = Number(process.env.DETAIL_CONCURRENCY || 8);
const LIST_CONCURRENCY = Number(process.env.SMARTRECRUITERS_LIST_CONCURRENCY || 8);

const stats = {
  companies: 0,
  companiesFailed: 0,
  listed: 0,
  offDomain: 0,
  detailFailed: 0,
  processed: 0,
  saved: 0,
  deduped: 0,
  failed: 0,
};

// All US postings for one company, or null if the listing failed.
async function fetchCompanyJobs(company) {
  const jobs = [];
  const limit = 100;
  try {
    for (let offset = 0; ; offset += limit) {
      const { data } = await withRetry(() =>
        httpClient.get(`https://api.smartrecruiters.com/v1/companies/${company}/postings`, {
          params: { country: "us", limit, offset },
        }),
      );
      const page = data?.content || [];
      jobs.push(...page);
      if (page.length < limit) return jobs;
    }
  } catch (err) {
    console.error(`❌ ${company}: ${err.response?.status || err.message}`);
    return null;
  }
}

async function fetchJobDetails(job) {
  try {
    return (await withRetry(() => httpClient.get(job.ref))).data;
  } catch {
    return null;
  }
}

export default async function collectSmartRecruitersJobs() {
  console.log("\n==========================================");
  console.log("🚀 SmartRecruiters Collector Started");
  console.log("==========================================\n");

  const listedIds = new Set();
  const candidates = [];

  await runPool(
    companies,
    async (company) => {
      stats.companies++;
      const jobs = await fetchCompanyJobs(company);
      if (!jobs) {
        stats.companiesFailed++;
        return;
      }
      stats.listed += jobs.length;
      for (const job of jobs) {
        listedIds.add(String(job.id));
        if (isDomainJob(job.name)) candidates.push(job);
        else stats.offDomain++;
      }
    },
    LIST_CONCURRENCY,
  );
  console.log(`📄 ${stats.listed} US postings, ${candidates.length} IT`);

  const rows = await runPool(
    candidates,
    async (job) => {
      const details = await fetchJobDetails(job);
      if (!details) {
        stats.detailFailed++;
        return null;
      }
      stats.processed++;
      return normalizeSmartRecruiters(details);
    },
    DETAIL_CONCURRENCY,
  );

  const r = await saveJobs(rows.filter(Boolean), stats);
  if (r.deduped) console.log(`   🧹 ${r.deduped} duplicate(s) collapsed`);
  console.log(`   💾 saved ${r.saved}/${r.attempted}`);

  // Rows store the company display name, not the slug, so a failed listing's
  // jobs can't be told apart here; skip the pass rather than hide them.
  if (stats.companiesFailed) {
    console.log(`⏭ Skipping deactivation: ${stats.companiesFailed} company listing(s) failed`);
  } else {
    await deactivateMissing("smartrecruiters", listedIds);
  }

  console.log("\n==========================================");
  console.log("✅ SmartRecruiters Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectSmartRecruitersJobs);

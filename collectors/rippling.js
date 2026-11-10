import axios from "axios";
import { runCollector } from "./runtime.js";
import { normalizeBasic } from "./normalize/normalizeBasic.js";
import { isUsJob } from "./lib/isUsJob.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import companies from "./config/ripplingCompanies.js";
import runPool from "../processors/workerPool.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";

// Rippling ATS job boards (https://ats.rippling.com/{slug}/jobs). Public JSON
// API, no key:
//   GET /platform/api/ats/v1/board/{slug}/jobs         -> [{uuid, name, url, workLocation, department}]
//   GET /platform/api/ats/v1/board/{slug}/jobs/{uuid}  -> full posting
// The company list comes from verifyBoards.js (npm run verify-rippling). Every listed IT job is
// re-saved each run, and jobs that leave a board are hidden at the end.

const API = "https://api.rippling.com/platform/api/ats/v1/board";
const UA = "AIFAGenJobCollector/1.0 (+https://aifagenlabs.com)";
const DETAIL_CONCURRENCY = Number(process.env.RIPPLING_CONCURRENCY || 4);

const stats = {
  companies: 0,
  boardsFailed: 0,
  listed: 0,
  offDomain: 0,
  nonUs: 0,
  detailFailed: 0,
  processed: 0,
  saved: 0,
  deduped: 0,
  failed: 0,
};

const http = axios.create({ timeout: 20000, headers: { "User-Agent": UA } });

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await http.get(url)).data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < 3) {
        const waitS = Number(err.response.headers?.["retry-after"]) || 10 * (attempt + 1);
        await new Promise((r) => setTimeout(r, waitS * 1000));
        continue;
      }
      throw err;
    }
  }
}

// The list shows one location; the detail has all of them.
const locationOf = (job, detail) =>
  (detail?.workLocations?.length ? detail.workLocations : [job.workLocation?.label])
    .filter(Boolean)
    .join(" / ");

export default async function collectRipplingJobs() {
  console.log("\n==========================================");
  console.log("🚀 Rippling Collector Started");
  console.log("==========================================\n");

  // Every posting listed, and the ones kept (IT, US): listed jobs that are
  // filtered out are hidden too.
  const listed = new Set();
  const listedIds = new Set();
  const failedCompanies = new Set();

  for (const slug of companies) {
    stats.companies++;
    let jobs;
    try {
      jobs = await getJson(`${API}/${slug}/jobs`);
    } catch (err) {
      stats.boardsFailed++;
      console.error(`❌ ${slug}: ${err.response?.status || err.message}`);
      failedCompanies.add(slug);
      continue;
    }
    if (!Array.isArray(jobs)) continue;
    stats.listed += jobs.length;
    for (const job of jobs) listed.add(job.uuid);

    // Cheap checks on the list entry first, so details are fetched only for
    // IT jobs that could be in the US.
    const candidates = jobs.filter((job) => {
      if (!isDomainJob(job.name)) {
        stats.offDomain++;
        return false;
      }
      return true;
    });

    const rows = await runPool(
      candidates,
      async (job) => {
        let detail;
        try {
          detail = await getJson(`${API}/${slug}/jobs/${job.uuid}`);
        } catch {
          // Still listed: leave whatever is stored for it as it is.
          stats.detailFailed++;
          listedIds.add(job.uuid);
          return null;
        }
        const row = await normalizeBasic({
          source: "rippling",
          id: job.uuid,
          title: job.name,
          company: detail.companyName || detail.board?.companyName || slug,
          location: locationOf(job, detail),
          descriptionHtml: [detail.description?.company, detail.description?.role]
            .filter(Boolean)
            .join("\n"),
          applyUrl: detail.url || job.url,
          postedDate: detail.createdOn ? new Date(detail.createdOn).toISOString() : undefined,
          employmentType: detail.employmentType?.id || "",
        });
        if (!isUsJob(row)) {
          stats.nonUs++;
          return null;
        }
        stats.processed++;
        listedIds.add(job.uuid);
        return row;
      },
      DETAIL_CONCURRENCY,
    );

    const kept = rows.filter(Boolean);
    const r = await saveJobs(kept, stats);
    console.log(`🏢 ${slug}: ${jobs.length} listed, ${kept.length} US IT, saved ${r.saved}`);
  }

  // Rows store the company display name, not the slug, so a failed board's
  // jobs can't be matched by name here. If any board failed, skip the pass
  // rather than hide that board's open jobs.
  if (failedCompanies.size) {
    console.log(`⏭ Skipping deactivation: ${failedCompanies.size} board(s) failed to load`);
  } else {
    await deactivateMissing("rippling", listedIds, new Set(), { listed });
  }

  console.log("\n==========================================");
  console.log("✅ Rippling Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectRipplingJobs);

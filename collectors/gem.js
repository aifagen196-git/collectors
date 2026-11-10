import axios from "axios";
import { runCollector } from "./runtime.js";
import { normalizeBasic } from "./normalize/normalizeBasic.js";
import { isUsJob } from "./lib/isUsJob.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import companies from "./config/gemCompanies.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";

// Gem ATS job boards (https://jobs.gem.com/{slug}), mostly US startups.
// Public JSON API, no key; one call returns every open post with its full
// description:
//   GET https://api.gem.com/job_board/v0/{slug}/job_posts/
//     -> [{id, title, content, location: {name}, offices, location_type,
//          employment_type, first_published_at, absolute_url}]
// The API has no company name, so it is read from the board page's <title>
// ("Acme Careers"). The company list comes from verifyBoards.js
// (npm run verify-gem). Every listed IT job is re-saved each run, and jobs
// that leave a board are hidden at the end.

const API = "https://api.gem.com/job_board/v0";
const UA = "AIFAGenJobCollector/1.0 (+https://aifagenlabs.com)";

const stats = {
  companies: 0,
  boardsFailed: 0,
  listed: 0,
  offDomain: 0,
  nonUs: 0,
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
      if (err.response?.status === 429 && attempt < 3) {
        const waitS = Number(err.response.headers?.["retry-after"]) || 10 * (attempt + 1);
        await new Promise((r) => setTimeout(r, waitS * 1000));
        continue;
      }
      throw err;
    }
  }
}

const prettySlug = (slug) =>
  slug.replace(/^-+/, "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

async function companyName(slug) {
  try {
    const { data } = await http.get(`https://jobs.gem.com/${slug}`);
    const title = String(data).match(/<title>([^<]+)<\/title>/i)?.[1] || "";
    const name = title.replace(/\s*[-|]\s*Gem\s*$/i, "").replace(/\s+(Careers|Jobs)\s*$/i, "").trim();
    if (name && !/^work with us!?$/i.test(name)) return name;
  } catch {
    // fall through
  }
  return prettySlug(slug);
}

// "Los Angeles, United States" plus any other offices; remote posts often
// carry their country ("United States - Remote").
function locationOf(post) {
  const names = [post.location?.name, ...(post.offices || []).map((o) => o.location?.name || o.name)]
    .filter(Boolean)
    .map((s) => s.trim());
  return [...new Set(names)].join(" / ");
}

export default async function collectGemJobs() {
  console.log("\n==========================================");
  console.log("🚀 Gem Collector Started");
  console.log("==========================================\n");

  const listedIds = new Set();
  let anyBoardFailed = false;

  for (const slug of companies) {
    stats.companies++;
    let posts;
    try {
      posts = await getJson(`${API}/${slug}/job_posts/`);
    } catch (err) {
      stats.boardsFailed++;
      anyBoardFailed = true;
      console.error(`❌ ${slug}: ${err.response?.status || err.message}`);
      continue;
    }
    if (!Array.isArray(posts)) continue;
    stats.listed += posts.length;
    for (const p of posts) listedIds.add(String(p.id));

    const candidates = posts.filter((p) => {
      if (!isDomainJob(p.title)) {
        stats.offDomain++;
        return false;
      }
      return true;
    });
    if (!candidates.length) {
      console.log(`🏢 ${slug}: ${posts.length} listed, 0 IT`);
      continue;
    }

    const company = await companyName(slug);
    const kept = [];
    for (const p of candidates) {
      const row = await normalizeBasic({
        source: "gem",
        id: p.id,
        title: p.title,
        company,
        location: locationOf(p),
        descriptionHtml: p.content || p.content_plain || "",
        applyUrl: p.absolute_url,
        postedDate: p.first_published_at || p.created_at || undefined,
        employmentType: p.employment_type || "",
      });
      if (!isUsJob(row)) {
        stats.nonUs++;
        continue;
      }
      stats.processed++;
      kept.push(row);
    }

    const r = await saveJobs(kept, stats);
    console.log(`🏢 ${company}: ${posts.length} listed, ${kept.length} US IT, saved ${r.saved}`);
  }

  // Rows store the company display name, not the slug, so a failed board's
  // jobs can't be told apart here. If any board failed, skip the pass rather
  // than hide that board's open jobs.
  if (anyBoardFailed) {
    console.log(`⏭ Skipping deactivation: ${stats.boardsFailed} board(s) failed to load`);
  } else {
    await deactivateMissing("gem", listedIds);
  }

  console.log("\n==========================================");
  console.log("✅ Gem Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectGemJobs);

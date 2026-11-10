import axios from "axios";
import * as cheerio from "cheerio";
import { runCollector } from "./runtime.js";
import { normalizeWeWorkRemotelyJob, splitTitle } from "./normalize/normalizeWeworkremotely.js";
import { isUsJob } from "./lib/isUsJob.js";
import { isGigListing } from "./lib/isGigListing.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { saveJobs, deactivateMissing } from "../processors/saveJobs.js";

// We Work Remotely publishes RSS only (no JSON API). The IT category feeds
// are read instead of the site-wide one, which holds just the newest 100
// listings of every kind. Postings are paid for by the employer, so the feed
// has little spam; jobs are kept by IT title rather than by a company
// allowlist (until 2026-11-10 an allowlist dropped 86 of 100 jobs). Jobs that
// leave the feeds are hidden at the end.

const FEEDS = [
  "remote-full-stack-programming-jobs",
  "remote-back-end-programming-jobs",
  "remote-front-end-programming-jobs",
  "remote-programming-jobs",
  "remote-devops-sysadmin-jobs",
  "remote-product-jobs",
].map((c) => `https://weworkremotely.com/categories/${c}.rss`);

const UA = "AIFAGenJobCollector/1.0 (+https://aifagenlabs.com)";

const stats = {
  feedsFailed: 0,
  fetched: 0,
  offDomain: 0,
  gigListing: 0,
  nonUs: 0,
  processed: 0,
  saved: 0,
  deduped: 0,
  failed: 0,
};

async function fetchFeedItems(url) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" },
  });
  const $ = cheerio.load(data, { xmlMode: true });
  return $("item")
    .map((_, el) => {
      const $el = $(el);
      const text = (tag) => $el.find(tag).first().text();
      return {
        title: text("title"),
        link: text("link"),
        guid: text("guid"),
        region: text("region"),
        country: text("country"),
        state: text("state"),
        skills: text("skills"),
        category: text("category"),
        type: text("type"),
        description: text("description"),
        pubDate: text("pubDate"),
      };
    })
    .get();
}

export default async function collectWeWorkRemotelyJobs() {
  console.log("\n==========================================");
  console.log("🚀 We Work Remotely Collector Started");
  console.log("==========================================\n");

  const byId = new Map();
  for (const url of FEEDS) {
    try {
      const items = await fetchFeedItems(url);
      for (const item of items) byId.set(String(item.guid || item.link), item);
      console.log(`📥 ${items.length} from ${url.split("/").pop()}`);
    } catch (err) {
      stats.feedsFailed++;
      console.error(`❌ ${url}: ${err.response?.status || err.message}`);
    }
  }
  stats.fetched = byId.size;

  const rows = [];
  for (const item of byId.values()) {
    if (!isDomainJob(splitTitle(item.title).title)) {
      stats.offDomain++;
      continue;
    }
    const row = await normalizeWeWorkRemotelyJob(item);
    if (isGigListing(row)) {
      stats.gigListing++;
      continue;
    }
    if (!isUsJob(row)) {
      stats.nonUs++;
      continue;
    }
    rows.push(row);
    stats.processed++;
  }

  await saveJobs(rows, stats);

  if (stats.feedsFailed) {
    console.log(`⏭ Skipping deactivation: ${stats.feedsFailed} feed(s) failed`);
  } else {
    await deactivateMissing("weworkremotely", new Set(byId.keys()));
  }

  console.log("\n==========================================");
  console.log("✅ We Work Remotely Collector Finished");
  console.log("==========================================");
  console.table(stats);
  console.log("==========================================\n");

  return { saved: stats.saved, failed: stats.failed };
}

runCollector(import.meta.url, collectWeWorkRemotelyJobs);

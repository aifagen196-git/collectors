// Checks candidate Workday career sites before they go into
// config/workdayCompanies.js. Workday has no directory, and a wrong siteId
// quietly returns nothing, so each candidate is tried against the same
// `wday/cxs/{tenant}/{siteId}/jobs` search the collector uses, on its own
// host shard first and then the other common shards.
//
//   node collectors/verifyWorkday.js
//
// Reads collectors/config/workdayCandidates.js. Prints the boards that answer,
// with their total postings and how many of the first 100 are US IT jobs.
// Nothing is written: copy the good lines into workdayCompanies.js by hand.

import axios from "axios";
import candidates from "./config/workdayCandidates.js";
import existing from "./config/workdayCompanies.js";
import { isDomainJob } from "./lib/isDomainJob.js";
import { usFromLocation } from "./lib/isUsJob.js";

const HOSTS = ["wd1", "wd5", "wd3", "wd12", "wd10", "wd103", "wd501"];
const CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY || 4);
const have = new Set(existing.map((c) => `${c.company}|${c.siteId}`.toLowerCase()));

async function search(company, host, siteId) {
  const url = `https://${company}.${host}.myworkdayjobs.com/wday/cxs/${company}/${siteId}/jobs`;
  try {
    const { data } = await axios.post(
      url,
      { appliedFacets: {}, limit: 20, offset: 0, searchText: "" },
      { timeout: 15000, headers: { "Content-Type": "application/json", Accept: "application/json" } },
    );
    return data;
  } catch {
    return null;
  }
}

async function sample(company, host, siteId, total) {
  const postings = [];
  for (let offset = 0; offset < Math.min(total, 100); offset += 20) {
    const url = `https://${company}.${host}.myworkdayjobs.com/wday/cxs/${company}/${siteId}/jobs`;
    try {
      const { data } = await axios.post(url, { appliedFacets: {}, limit: 20, offset, searchText: "" }, { timeout: 15000 });
      postings.push(...(data?.jobPostings || []));
    } catch {
      break;
    }
  }
  return postings.filter((p) => isDomainJob(p.title || "") && usFromLocation(p.locationsText) !== false).length;
}

async function check(c) {
  if (have.has(`${c.company}|${c.siteId}`.toLowerCase())) return { ...c, status: "already listed" };
  const hosts = [c.host, ...HOSTS.filter((h) => h !== c.host)];
  for (const host of hosts) {
    const data = await search(c.company, host, c.siteId);
    if (data && Number(data.total) > 0) {
      const usIt = await sample(c.company, host, c.siteId, Number(data.total));
      return { ...c, host, total: Number(data.total), usIt, status: "ok" };
    }
  }
  return { ...c, status: "no answer" };
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < candidates.length) {
      const c = candidates[next++];
      const r = await check(c);
      results.push(r);
      console.log(`${r.status === "ok" ? "OK " : "-- "} ${c.company} ${r.host || c.host} ${c.siteId} ${r.status === "ok" ? `total ${r.total}, US IT in first 100: ${r.usIt}` : r.status}`);
    }
  }),
);

const good = results.filter((r) => r.status === "ok" && r.usIt > 0).sort((a, b) => b.usIt - a.usIt);
console.log(`\n${good.length} of ${candidates.length} candidates answer with US IT jobs:`);
for (const r of good) {
  console.log(`  { company: "${r.company}", host: "${r.host}", siteId: "${r.siteId}" }, // ~${r.total} reqs, ${r.usIt}/100 US IT`);
}

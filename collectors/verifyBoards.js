// collectors/verifyBoards.js
//
// Builds or extends a collector's company list by trying candidate slugs
// against that ATS's public board API:
//
//   node collectors/verifyBoards.js greenhouse [--from-db]
//   node collectors/verifyBoards.js lever | ashby | smartrecruiters | recruitee
//   node collectors/verifyBoards.js rippling | gem | personio | breezyhr
//
// Candidates are every slug in the config/*Companies.js lists (including the
// names in config/candidateCompanies.js) and, with --from-db, the company
// names stored in the jobs table. A new slug is added when its board lists at
// least one IT job in the US, the only jobs the collectors keep. For the big
// lists (greenhouse, lever, ashby, smartrecruiters, recruitee) the current
// slugs stay unless their board is gone (404); for the others the list is
// rebuilt from the boards that have jobs. The number after each slug is its
// count of US IT jobs at the time.
//
// Re-run now and then to pick up new companies and drop closed boards.

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isUsJob, usFromLocation } from "./lib/isUsJob.js";
import { isDomainJob } from "./lib/isDomainJob.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(dir, "config");
const ROOT_CONFIG_DIR = path.join(dir, "..", "config");
const CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY || 8);
const UA = "AIFAGenJobCollector/1.0 (+https://aifagenlabs.com)";

const http = axios.create({ timeout: 15000, validateStatus: null, headers: { "User-Agent": UA } });

const isUsCountry = (c) => /^(us|usa|united states)$/i.test(String(c || "").trim());
// Where a board doesn't say ("Remote"), count the job: the collector reads
// the full description before deciding.
const maybeUs = (location) => usFromLocation(location) !== false;

// check(slug) returns the board's US IT job count (0 = board exists, nothing
// to collect), null when there is no such board (404), "rate-limited", or
// "error" for any other failure (an existing slug is kept on an error).
const statusOf = (res, ok) =>
  res.status === 429 ? "rate-limited" : res.status === 404 ? null : res.status !== 200 || !ok ? "error" : "ok";

const PROVIDERS = {
  greenhouse: {
    url: "https://boards.greenhouse.io/{slug}",
    file: path.join(ROOT_CONFIG_DIR, "greenhouseCompanies.js"),
    keepExisting: true,
    async check(slug) {
      const res = await http.get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
      const s = statusOf(res, Array.isArray(res.data?.jobs));
      if (s !== "ok") return s;
      return res.data.jobs.filter((j) => isDomainJob(j.title) && maybeUs(j.location?.name)).length;
    },
  },
  lever: {
    url: "https://jobs.lever.co/{slug}",
    file: path.join(ROOT_CONFIG_DIR, "leverCompanies.js"),
    keepExisting: true,
    async check(slug) {
      const res = await http.get(`https://api.lever.co/v0/postings/${slug}`, { params: { mode: "json" } });
      const s = statusOf(res, Array.isArray(res.data));
      if (s !== "ok") return s;
      return res.data.filter(
        (j) => isDomainJob(j.text) && (j.country ? j.country === "US" : maybeUs(j.categories?.location)),
      ).length;
    },
  },
  ashby: {
    url: "https://jobs.ashbyhq.com/{slug}",
    file: path.join(ROOT_CONFIG_DIR, "ashbyCompanies.js"),
    keepExisting: true,
    async check(slug) {
      const res = await http.get(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      const s = statusOf(res, Array.isArray(res.data?.jobs));
      if (s !== "ok") return s;
      return res.data.jobs.filter((j) => {
        if (!isDomainJob(j.title)) return false;
        const country = j.address?.postalAddress?.addressCountry;
        return country ? isUsCountry(country) : maybeUs(j.location);
      }).length;
    },
  },
  smartrecruiters: {
    url: "https://jobs.smartrecruiters.com/{slug}",
    file: path.join(ROOT_CONFIG_DIR, "smartrecruitersCompanies.js"),
    keepExisting: true,
    note: "SmartRecruiters answers any slug, so a slug with no US posting can't be told from a typo.",
    async check(slug) {
      const res = await http.get(`https://api.smartrecruiters.com/v1/companies/${slug}/postings`, {
        params: { country: "us", limit: 100 },
      });
      const s = statusOf(res, Array.isArray(res.data?.content));
      if (s !== "ok") return s;
      // Counts only the first 100 US postings: enough to decide.
      return res.data.content.filter((j) => isDomainJob(j.name)).length;
    },
  },
  recruitee: {
    url: "https://{slug}.recruitee.com",
    file: path.join(CONFIG_DIR, "recruiteeCompanies.js"),
    keepExisting: true,
    async check(slug) {
      const res = await http.get(`https://${slug}.recruitee.com/api/offers/`);
      // An unknown subdomain can also answer with an HTML page.
      if (res.status === 200 && !Array.isArray(res.data?.offers)) return null;
      const s = statusOf(res, true);
      if (s !== "ok") return s;
      return res.data.offers.filter(
        (o) => isDomainJob(o.title) && (o.country_code ? o.country_code === "US" : maybeUs(o.location)),
      ).length;
    },
  },
  rippling: {
    url: "https://ats.rippling.com/{slug}/jobs",
    file: path.join(CONFIG_DIR, "ripplingCompanies.js"),
    async check(slug) {
      const res = await http.get(`https://api.rippling.com/platform/api/ats/v1/board/${slug}/jobs`);
      if (res.status === 429) return "rate-limited";
      if (res.status !== 200 || !Array.isArray(res.data)) return 0;
      return res.data.filter((j) => isDomainJob(j.name) && maybeUs(j.workLocation?.label)).length;
    },
  },
  gem: {
    url: "https://jobs.gem.com/{slug}",
    file: path.join(CONFIG_DIR, "gemCompanies.js"),
    async check(slug) {
      const res = await http.get(`https://api.gem.com/job_board/v0/${slug}/job_posts/`);
      if (res.status === 429) return "rate-limited";
      if (res.status !== 200 || !Array.isArray(res.data)) return 0;
      return res.data.filter((p) => {
        if (!isDomainJob(p.title)) return false;
        const places = [p.location?.name, ...(p.offices || []).map((o) => o.location?.name || o.name)].filter(Boolean);
        return !places.length || places.some((l) => maybeUs(l));
      }).length;
    },
  },
  breezyhr: {
    url: "https://{slug}.breezy.hr",
    file: path.join(CONFIG_DIR, "breezyhrCompanies.js"),
    async check(slug) {
      const res = await http.get(`https://${slug}.breezy.hr/json`);
      if (res.status === 429) return "rate-limited";
      if (res.status !== 200 || !Array.isArray(res.data)) return 0;
      return res.data.filter((j) => {
        if (!isDomainJob(j.name)) return false;
        const l = j.location || {};
        const text = [l.name, l.city, l.state?.name, l.country?.name].filter(Boolean).join(", ");
        return l.country?.id === "US" || isUsJob({ location: text });
      }).length;
    },
  },
  personio: {
    url: "https://{slug}.jobs.personio.de",
    file: path.join(CONFIG_DIR, "personioCompanies.js"),
    async check(slug) {
      for (const domain of ["jobs.personio.de", "jobs.personio.com"]) {
        const res = await http.get(`https://${slug}.${domain}/xml`);
        if (res.status === 429) return "rate-limited";
        if (res.status !== 200 || typeof res.data !== "string" || !res.data.includes("<position>")) continue;
        const $ = cheerio.load(res.data, { xmlMode: true });
        let us = 0;
        $("position").each((_, el) => {
          if (!isDomainJob($(el).find("name").first().text().trim())) return;
          const offices = [$(el).find("office").first().text(), ...$(el).find("additionalOffices > office").map((__, o) => $(o).text()).get()];
          if (offices.some((o) => isUsJob({ location: o.trim() }))) us++;
        });
        return us;
      }
      return 0;
    },
  },
};

const toSlug = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// "Acme Technologies, Inc." -> acme-technologies-inc, acmetechnologiesinc,
// acme-technologies, acmetechnologies, acme
const LEGAL_WORDS = /-(inc|llc|ltd|corp|corporation|co|company|group|holdings|technologies|technology|labs|software|systems|solutions|hq|the)$/;
function slugVariants(name) {
  const out = new Set();
  let s = toSlug(name);
  if (!s || s.length > 40) return out;
  for (let i = 0; i < 3 && s; i++) {
    out.add(s);
    out.add(s.replace(/-/g, ""));
    const next = s.replace(LEGAL_WORDS, "");
    if (next === s) break;
    s = next;
  }
  const first = s.split("-")[0];
  if (first && first.length > 2) out.add(first);
  return out;
}

async function listFile(file) {
  try {
    const m = await import(pathToFileURL(file).href);
    const list = m.default || Object.values(m)[0];
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

async function candidateSlugs(fromDb) {
  const slugs = new Set();
  const files = [
    ...fs.readdirSync(CONFIG_DIR).map((f) => path.join(CONFIG_DIR, f)),
    ...fs.readdirSync(ROOT_CONFIG_DIR).map((f) => path.join(ROOT_CONFIG_DIR, f)),
  ].filter((f) => /Companies\.js$/.test(f));
  for (const f of files) {
    const list = await listFile(f);
    if (!list) continue;
    for (const x of list) {
      for (const c of [typeof x === "string" ? x : null, x?.slug, x?.board, x?.token, x?.company, x?.name]) {
        if (c) for (const s of slugVariants(c)) slugs.add(s);
      }
    }
  }
  if (fromDb) {
    const { getSupabase } = await import("./runtime.js");
    const sb = getSupabase();
    let n = 0;
    // Keyset paging (id > last), not offsets: each offset page re-reads every
    // row before it, which loaded the database enough to time out a
    // collector's deactivation pass running at the same time.
    for (let last = null; ; ) {
      let q = sb.from("jobs").select("id, company").order("id").limit(1000);
      if (last !== null) q = q.gt("id", last);
      const { data, error } = await q;
      if (error) throw new Error(`company lookup failed: ${error.message}`);
      for (const r of data) if (r.company) for (const s of slugVariants(r.company)) slugs.add(s);
      n += data.length;
      if (data.length < 1000) break;
      last = data[data.length - 1].id;
    }
    console.log(`Read company names from ${n} stored jobs`);
  }
  return [...slugs].sort();
}

async function main() {
  const name = process.argv[2];
  const fromDb = process.argv.includes("--from-db");
  const provider = PROVIDERS[name];
  if (!provider) {
    console.error(`Usage: node collectors/verifyBoards.js <${Object.keys(PROVIDERS).join("|")}> [--from-db]`);
    process.exit(1);
  }
  const out = provider.file;
  const current = (await listFile(out)) || [];
  const existing = new Set(current.map((x) => (typeof x === "string" ? x : x?.slug)).filter(Boolean));

  const slugs = [...new Set([...existing, ...(await candidateSlugs(fromDb))])];
  console.log(`Checking ${slugs.length} slugs against ${name} (${existing.size} on the list now)...`);
  const result = new Map(); // slug -> count | null | "rate-limited" | "error"
  let i = 0;
  let checked = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < slugs.length) {
        const slug = slugs[i++];
        let n;
        try {
          n = await provider.check(slug);
        } catch {
          // DNS failure (subdomain boards), timeout, bad JSON.
          n = existing.has(slug) ? "error" : null;
        }
        result.set(slug, n);
        checked++;
        if (typeof n === "number" && n > 0 && !existing.has(slug)) console.log(`  ✅ new: ${slug} (${n} US IT jobs)`);
        if (checked % 500 === 0) console.log(`  ...${checked}/${slugs.length}`);
      }
    }),
  );

  const keep = [];
  const dropped = [];
  let limited = 0;
  for (const slug of slugs) {
    const n = result.get(slug);
    if (n === "rate-limited") limited++;
    if (existing.has(slug)) {
      // A board that answered keeps its place; one that is gone (404) is dropped.
      if (provider.keepExisting ? n !== null : n !== 0 && n !== null) keep.push({ slug, n });
      else dropped.push(slug);
    } else if (typeof n === "number" && n > 0) {
      keep.push({ slug, n });
    }
  }
  keep.sort((a, b) => a.slug.localeCompare(b.slug));
  const added = keep.filter((k) => !existing.has(k.slug));

  if (!keep.length) {
    console.log(`\nNo boards found; ${out} left unchanged. Rate-limited: ${limited}.`);
    return;
  }
  const label = (n) => (typeof n === "number" ? ` // ${n}` : "");
  const body = `// ${path.relative(path.join(dir, ".."), out).replace(/\\/g, "/")}
//
// ${name} board slugs (${provider.url}), checked by collectors/verifyBoards.js
// on ${new Date().toISOString().slice(0, 10)}. The number is the board's count of US IT jobs then.${provider.note ? `\n// ${provider.note}` : ""}
//
// ${keep.length} boards.

const companies = [
${keep.map((k) => `  "${k.slug}",${label(k.n)}`).join("\n")}
];

export default companies;
`;
  fs.writeFileSync(out, body);
  const total = keep.reduce((s, k) => s + (typeof k.n === "number" ? k.n : 0), 0);
  console.log(
    `\n${keep.length} boards (${added.length} new, ${dropped.length} dropped), ${total} US IT jobs. Rate-limited: ${limited}. Wrote ${out}`,
  );
  if (added.length) console.log(`New: ${added.map((k) => `${k.slug}(${k.n})`).join(", ")}`);
  if (dropped.length) console.log(`Dropped: ${dropped.join(", ")}`);
}

main();

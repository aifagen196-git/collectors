import { extractJobProfile } from "./extractProfile.js";
import normalizeCompany from "./companyNormalizer.js";
import parseLocation from "./locationParser.js";
import extractEmploymentType from "./employmentTypeExtractor.js";
import { normalizeCountry, normalizeEmploymentType } from "./canonicalFields.js";

// HTML -> plain text, keeping list items and paragraphs on their own lines so
// requirements read as separate statements ("5+ years of Python" doesn't run
// into the next bullet).
function htmlToText(html = "") {
  return String(html)
    .replace(/<\s*(br|\/p|\/div|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Lever splits a posting into an intro (description), titled lists
// (Responsibilities, Requirements, What We're Looking For, ...) and a closing
// section (additional: benefits, pay transparency, work authorization). Only
// the intro used to be stored, so the requirements, which carry the skills and
// years, never reached the extraction: on 60 live postings, 0.8 skills and no
// years per job, against 5.0 skills and years on 40% with the full text. The
// lists come right after the intro so they survive the 8,000-character cap.
function fullText(job) {
  const parts = [job.descriptionPlain || htmlToText(job.description)];
  for (const list of job.lists || []) {
    const body = htmlToText(list.content);
    if (body) parts.push(`${(list.text || "").trim()}:\n${body}`);
  }
  parts.push(job.additionalPlain || htmlToText(job.additional));
  return parts.map((p) => String(p || "").trim()).filter(Boolean).join("\n\n");
}

const INTERVALS = {
  "per-year-salary": "a year",
  "per-month-salary": "a month",
  "per-hour-wage": "an hour",
  "per-day-wage": "a day",
  "per-week-salary": "a week",
};
function salaryText(job) {
  const r = job.salaryRange;
  if (r && (r.min || r.max)) {
    const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const cur = r.currency === "USD" || !r.currency ? "$" : `${r.currency} `;
    const range = r.min && r.max && r.min !== r.max ? `${cur}${fmt(r.min)} - ${cur}${fmt(r.max)}` : `${cur}${fmt(r.min || r.max)}`;
    return `${range}${INTERVALS[r.interval] ? ` ${INTERVALS[r.interval]}` : ""}`;
  }
  const d = (job.salaryDescriptionPlain || "").trim();
  return d ? d.slice(0, 200) : null;
}

// Lever's workplaceType -> the work_mode values the matcher reads.
const WORK_MODES = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite" };

// Lever states the workplace type explicitly. Put it in the location text,
// which is what the matcher and the job card read for remote/hybrid.
function locationText(job) {
  const loc = (job.categories?.location || "").trim();
  if (job.workplaceType === "remote" && !/\bremote\b/i.test(loc)) return loc ? `Remote - ${loc}` : "Remote";
  if (job.workplaceType === "hybrid" && !/\bhybrid\b/i.test(loc)) return loc ? `${loc} (Hybrid)` : "Hybrid";
  return loc;
}

export async function normalizeLever(job, company) {
  const description = fullText(job);
  const location = locationText(job);

  const profile = await extractJobProfile(description, { title: job.text });
  const loc = parseLocation(job.categories?.location || "");
  // Lever's own country code beats text detection.
  const country = normalizeCountry(job.country === "US" ? "United States" : loc.country || profile.country);
  const remote = job.workplaceType ? job.workplaceType === "remote" : loc.remote || profile.is_remote_us;
  const isRemoteUs = Boolean(remote && (country === "United States" || job.country === "US"));
  const workMode = WORK_MODES[job.workplaceType] ?? profile.work_mode;

  return {
    title: job.text || "Untitled",

    company: normalizeCompany(company) || company,

    location,

    employment_type:
      normalizeEmploymentType(
        job.categories?.commitment || extractEmploymentType(description),
      ) || "Full Time",

    salary: salaryText(job),

    description,

    source: "lever",

    source_job_id: String(job.id),

    apply_url: job.hostedUrl,

    posted_date: job.createdAt ? new Date(job.createdAt).toISOString() : null,

    skills: profile.skills_required || [],

    skills_required: profile.skills_required || [],

    skills_preferred: profile.skills_preferred || [],

    role_family: profile.role_family,

    min_years: profile.min_years,

    country,

    state: loc.state || profile.state,

    is_remote_us: isRemoteUs,

    profile: { ...profile, country, is_remote_us: isRemoteUs, work_mode: workMode },

    match_score: 0,

    is_active: true,

    last_seen: new Date().toISOString(),

    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

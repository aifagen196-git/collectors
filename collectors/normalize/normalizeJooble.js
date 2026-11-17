import { extractJobProfile } from "../processors/extractProfile.js";
import { extractEmploymentType } from "../../processors/employmentTypeExtractor.js";

// Jooble's snippet is HTML ("<b>Software Engineer </b>", "&nbsp;", "\r\n"),
// and 98% of stored Jooble descriptions still carried it.
function cleanSnippet(html = "") {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#43;/g, "+")
    .replace(/\s+/g, " ")
    .trim();
}

// Jooble's `salary` is free text and often empty; contract snippets usually
// state a rate instead ("Rate: $55 to $60/hr", "$120,000 - $140,000 a year").
const PAY_RE = /\$\s?\d[\d,.]*\s?k?(?:\s?(?:-|to|–)\s?\$?\s?\d[\d,.]*\s?k?)?\s?(?:\/\s?(?:hr|hour|yr|year)|(?:an|per|a)\s(?:hour|year))?/i;
function salaryText(job, snippet) {
  if (job.salary && String(job.salary).trim()) return String(job.salary).trim().slice(0, 200);
  const m = PAY_RE.exec(snippet);
  return m && /\d{2}/.test(m[0]) ? m[0].trim().replace(/[,.;:]+$/, "") : null;
}

/**
 * Converts a raw Jooble API job result into the enriched job shape the
 * other collectors produce. Field names follow Jooble's documented
 * POST /api/{key} response schema (title, location, snippet, salary,
 * source, type, link, company, updated, id).
 */
export async function normalizeJooble(job) {
  const description = cleanSnippet(job.snippet);

  const profile = await extractJobProfile(description, { title: job.title });

  return {
    title: cleanSnippet(job.title) || "",

    company: (job.company || "").trim(),

    location: job.location || "",

    // Jooble's `type` is empty on most rows; snippets often say it
    // ("Type : Contract", "12 Month Contract").
    employment_type: job.type || extractEmploymentType(`${job.title || ""}\n${description}`),

    salary: salaryText(job, description),

    description,

    source: "jooble",

    // Jooble's own upstream site name ("Lensa.com", "ziprecruiter.com", ...) —
    // this is an aggregator-of-aggregators, so keep it for dedupe/debugging.
    source_publisher: job.source || "",

    source_job_id: String(job.id),

    apply_url: job.link || "",

    posted_date: job.updated || new Date().toISOString(),

    skills: profile.skills_required,

    skills_required: profile.skills_required,

    skills_preferred: profile.skills_preferred,

    role_family: profile.role_family,

    min_years: profile.min_years,

    country: profile.country,

    state: profile.state,

    is_remote_us: profile.is_remote_us,

    profile,

    match_score: 0,

    is_active: true,

    last_seen: new Date().toISOString(),

    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

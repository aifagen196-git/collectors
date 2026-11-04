import { extractJobProfile } from "../processors/extractProfile.js";

/**
 * Converts a raw Findwork.dev API job result into the enriched job shape
 * the other collectors produce. Field names follow Findwork's
 * GET /api/jobs/ response (checked against a real response on 2026-11-04).
 */

// Findwork's `text` is HTML with escaped entities (Hacker News posts are
// passed through as-is). Same cleaning as normalizeHackernews.js, but line
// breaks are kept so the description stays readable.
function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function normalizeFindwork(job) {
  const description = htmlToText(job.text);

  const profile = await extractJobProfile(description, { title: job.role || job.title });

  return {
    title: job.role || job.title || "",

    company: job.company_name || "",

    // Keep the listed location even for remote jobs ("SF / NYC / Remote");
    // fall back to "Remote" only when none is given.
    location: job.location || (job.remote ? "Remote" : ""),

    employment_type: job.employment_type || "",

    salary: null,

    description,

    source: "findwork",

    source_publisher: job.source || "",

    source_job_id: String(job.id),

    apply_url: job.url || "",

    posted_date: job.date_posted || new Date().toISOString(),

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

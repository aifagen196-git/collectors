import { extractJobProfile } from "../processors/extractProfile.js";
import cleanDescription from "../../processors/cleanDescription.js";

/**
 * Builds a public.jobs row from the plain fields most sources expose (title,
 * company, location, HTML or text description, link, date). Shared by the
 * Rippling, RemoteLanders and Authentic Jobs collectors; the older collectors
 * each have their own copy of this shape.
 *
 * @param {object} raw
 * @param {string} raw.source - collector key, e.g. "rippling"
 * @param {string} raw.id - stable id on that source
 * @param {string} raw.title
 * @param {string} [raw.company]
 * @param {string} [raw.location]
 * @param {string} [raw.descriptionHtml] - HTML; cleaned to text here
 * @param {string} [raw.applyUrl]
 * @param {string} [raw.postedDate] - ISO date
 * @param {string} [raw.employmentType]
 * @param {string} [raw.salary]
 * @param {string} [raw.publisher] - original board, when the source aggregates
 * @param {string} [raw.expiresAt] - ISO date the posting closes, if the
 *   source says; otherwise 30 days from now
 */
export async function normalizeBasic(raw) {
  const description = cleanDescription(raw.descriptionHtml || "").trim();
  const title = String(raw.title || "").trim();
  const profile = await extractJobProfile(description, { title });
  const now = new Date();

  return {
    title,
    company: String(raw.company || "").trim(),
    location: String(raw.location || "").trim(),
    employment_type: raw.employmentType || "",
    salary: raw.salary || null,
    description,
    source: raw.source,
    source_publisher: raw.publisher || "",
    source_job_id: String(raw.id),
    apply_url: raw.applyUrl || "",
    posted_date: raw.postedDate || now.toISOString(),
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
    last_seen: now.toISOString(),
    expires_at:
      raw.expiresAt && Date.parse(raw.expiresAt) > now.getTime()
        ? new Date(raw.expiresAt).toISOString()
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

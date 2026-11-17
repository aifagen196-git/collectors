import { extractJobProfile } from "../processors/extractProfile.js";

export async function normalizeJobvertise(raw) {
  const profile = await extractJobProfile(raw.description, { title: raw.title });

  // Title and location only: the description is now the full posting, where
  // "remote" is often just a passing mention.
  const isRemote = /\bremote\b/i.test(raw.title || "") || /\bremote\b/i.test(raw.location || "");
  // From the job page's JSON-LD when it was fetched ("FULL_TIME", "CONTRACTOR").
  const TYPES = { FULL_TIME: "Full Time", PART_TIME: "Part Time", CONTRACTOR: "Contract", TEMPORARY: "Temporary", INTERN: "Internship" };
  const employmentType = String(raw.employmentType || "")
    .split(/,\s*/)
    .map((t) => TYPES[t.trim().toUpperCase()] || "")
    .find(Boolean) || "";
  const validThrough = raw.validThrough && !Number.isNaN(Date.parse(raw.validThrough)) ? new Date(raw.validThrough) : null;

  return {
    title: raw.title || "",

    company: raw.company || "",

    location: raw.location || (isRemote ? "Remote" : ""),

    employment_type: employmentType,

    salary: null,

    description: raw.description,

    source: "jobvertise",

    source_publisher: "",

    source_job_id: raw.id,

    apply_url: raw.applyUrl || "",

    posted_date: raw.postedDate || new Date().toISOString(),

    skills: profile.skills_required,

    skills_required: profile.skills_required,

    skills_preferred: profile.skills_preferred,

    role_family: profile.role_family,

    min_years: profile.min_years,

    country: profile.country,

    state: raw.state || profile.state,

    is_remote_us: isRemote ? true : profile.is_remote_us,

    profile,

    match_score: 0,

    is_active: true,

    last_seen: new Date().toISOString(),

    // The page's own validThrough when it is in the future, else 30 days.
    expires_at: (validThrough && validThrough > new Date() ? validThrough : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).toISOString(),
  };
}

import { extractJobProfile } from "../processors/extractProfile.js";

function cleanDescription(html = "") {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const EMPLOYMENT_TYPE_MAP = {
  permanent: "Full Time",
  temporary: "Contract",
  trainee: "Internship",
  intern: "Internship",
  freelance: "Contract",
};

// Personio offices are often "DE - Stuttgart" (country code first). Spelled
// out as "Stuttgart, Germany", because "DE" alone was read as Delaware and
// German jobs were saved as US ones (2026-11-04).
const OFFICE_COUNTRIES = {
  DE: "Germany", AT: "Austria", CH: "Switzerland", NL: "Netherlands", BE: "Belgium",
  FR: "France", ES: "Spain", IT: "Italy", PT: "Portugal", PL: "Poland", CZ: "Czech Republic",
  DK: "Denmark", SE: "Sweden", NO: "Norway", FI: "Finland", IE: "Ireland", GB: "United Kingdom",
  UK: "United Kingdom", LU: "Luxembourg", RO: "Romania", GR: "Greece", HU: "Hungary",
  US: "United States",
};

function officeToLocation(office) {
  const m = String(office).match(/^([A-Z]{2})\s*-\s*(.+)$/);
  if (!m || !OFFICE_COUNTRIES[m[1]]) return office;
  return `${m[2].trim()}, ${OFFICE_COUNTRIES[m[1]]}`;
}

export async function normalizePersonio(job, company) {
  const description = cleanDescription(job.descriptionHtml || "");

  const profile = await extractJobProfile(description, { title: job.name });

  return {
    title: job.name,

    company,

    location: [job.office, ...job.additionalOffices].filter(Boolean).map(officeToLocation).join(" | "),

    employment_type:
      EMPLOYMENT_TYPE_MAP[String(job.employmentType || "").toLowerCase()] ||
      "Full Time",

    salary: null,

    description,

    source: "personio",

    source_job_id: String(job.id),

    apply_url: `https://${company}.jobs.personio.de/job/${job.id}`,

    posted_date: job.createdAt || null,

    skills: profile.skills_required || [],

    skills_required: profile.skills_required || [],

    skills_preferred: profile.skills_preferred || [],

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

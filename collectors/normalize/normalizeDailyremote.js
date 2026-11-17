import { extractJobProfile } from "../processors/extractProfile.js";
import { SKILLS, canonical } from "../../vendor/skills.js";

// Tags are explicit skill labels here, so a tag that is a known skill counts
// even when the prose-oriented dictionary would not read it ("workday" alone).
const KNOWN_SKILLS = new Set(SKILLS.map(canonical));

// DailyRemote's location "pill" is often a broad region (e.g. "North
// America", "Worldwide") even when the title is explicit about the country
// ("Content Reviewer - English Speaker in United States"). Falling back to
// the title when it names the US keeps isUsJob() from wrongly dropping a
// US-targeted posting just because the pill text was vague.
const US_TITLE_RE = /\b(in the united states|in united states|\(us\)|- us\b|,\s*usa?\b)/i;

function resolveLocation(pillLocation, title) {
  if (pillLocation && /united states/i.test(pillLocation)) return pillLocation;
  if (US_TITLE_RE.test(title || "")) return "United States";
  return pillLocation || "";
}

// "2 hours ago" / "3 days ago" / "1 month ago" -> a date. The card shows
// nothing more precise; collection time was stored before, so every job
// looked brand new.
function postedFromAgo(text = "") {
  const m = /(\d+)\s*(minute|hour|day|week|month)s?\s+ago/i.exec(text);
  if (!m) return /just now|today/i.test(text) ? new Date() : null;
  const unit = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6 }[m[2].toLowerCase()];
  return new Date(Date.now() - Number(m[1]) * unit);
}

// DailyRemote hides the description and the employer from non-members; the
// free card has the title, type, age, location and tags only. Tags are
// hyphenated ("rest-api", "test-automation"), which the skill dictionary
// never matched.
export async function normalizeDailyremote(raw) {
  const tags = (raw.tags || []).map((t) => String(t).replace(/-/g, " "));
  const description = tags.length ? `Tags: ${tags.join(", ")}.` : "";

  const profile = await extractJobProfile(description, { title: raw.title });

  const resolved = resolveLocation(raw.location, raw.title);
  // Every listing on this board is remote. Say so in the location, which is
  // what the matcher and the job card read for remote work.
  const location = resolved ? (/\bremote\b/i.test(resolved) ? resolved : `Remote - ${resolved}`) : "Remote";
  const posted = postedFromAgo(raw.postedAgo);

  return {
    title: raw.title || "",

    company: raw.company || "",

    location,

    employment_type: raw.employmentType || "",

    salary: raw.salary || null,

    description,

    source: "dailyremote",

    source_publisher: "",

    source_job_id: raw.id,

    apply_url: raw.applyUrl || "",

    posted_date: (posted || new Date()).toISOString(),

    // One entry per skill: the dictionary's spelling wins over the tag's.
    skills: [...new Map([...profile.skills_required, ...tags.filter((t) => KNOWN_SKILLS.has(canonical(t)))].reverse().map((s) => [canonical(s), s])).values()].reverse(),

    skills_required: profile.skills_required,

    skills_preferred: profile.skills_preferred,

    role_family: profile.role_family,

    min_years: profile.min_years,

    country: profile.country,

    state: profile.state,

    is_remote_us: /united states/i.test(location) ? true : profile.is_remote_us,

    profile,

    match_score: 0,

    is_active: true,

    last_seen: new Date().toISOString(),

    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

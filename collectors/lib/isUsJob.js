// collectors/lib/isUsJob.js
//
// Shared US-only filter applied by every collector right before a job is
// saved. Each ATS hands back location data in a different shape, but every
// normalizer already reduces it to the same three fields on the job object
// it returns: `location` (free-text, e.g. "Austin, TX" / "Remote" /
// "Tel Aviv, Israel"), `country` (from extractJobProfile — LLM/heuristic
// inferred, not always populated), and `is_remote_us` (best-effort bool).
// This checks all three rather than relying on any single one, since none
// of them is reliable alone across 12 different ATS's.

const US_STATE_ABBR = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
]);

const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
  "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York",
  "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
];

// Case-sensitive \bUS\b (no /i) deliberately: bare "US" is a common
// remote-location marker ("Remote - US", "Remote (US)"), but lowercase
// "us" is also the common English pronoun, so only the all-caps form is
// treated as a country marker.
// The lookahead (not \b) lets "U.S." match before a space or bracket, as in
// "U.S. (Remote)" and "Remote, U.S.", which \b after the dot never did.
const US_MARKERS_RE = /\b(?:United States|USA|U\.S\.(?:A\.?)?)(?!\w)/i;
const US_BARE_RE = /\bUS\b/;
const US_STATE_NAME_RE = new RegExp(`\\b(${US_STATE_NAMES.join("|")})\\b`, "i");
// "City, ST" / "City, ST 12345" — the most common ATS location format.
const US_STATE_ABBR_RE = /,\s*([A-Z]{2})\b(?!\.\w)/;

// Non-US countries commonly seen in these ATS's location strings (Nordic/
// EU/Israel/UK-heavy, matching the customer bases scraped in this repo).
// If one of these appears and no US marker also appears, treat as non-US
// even when a two-letter token happens to collide with a US state
// abbreviation (e.g. "Ontario, CA" is a Canadian city, not California).
const NON_US_MARKERS_RE = new RegExp(
  "\\b(" +
    [
      "United Kingdom", "UK", "England", "Scotland", "Wales",
      "Ireland", "Germany", "France", "Netherlands", "Belgium",
      "Sweden", "Norway", "Denmark", "Finland", "Iceland",
      "Spain", "Italy", "Portugal", "Switzerland", "Austria",
      "Poland", "Israel", "India", "Canada", "Mexico", "Brazil",
      "Australia", "New Zealand", "Singapore", "Japan", "China",
      "South Korea", "UAE", "United Arab Emirates", "Philippines",
      "Ukraine", "Serbia", "Romania", "Czech Republic", "Greece",
      "Estonia", "Latvia", "Lithuania", "Luxembourg", "Malta",
      // Regions, as in "remote (EU)" / "Remote - EMEA"
      "EU", "Europe", "EMEA", "APAC", "LATAM",
    ].join("|") +
    ")\\b",
  "i",
);

/**
 * @param {{location?: string, country?: string|null, is_remote_us?: boolean}} job
 * @returns {boolean}
 */
export function isUsJob(job) {
  const location = String(job.location || "").trim();

  // A location that names another country or region and nothing American
  // wins over the inferred fields: extractJobProfile reads "DE - Stuttgart"
  // (Personio's office format) as Delaware and sets country = United States,
  // which let German jobs through (2026-11-04).
  const hasUsSignal =
    US_MARKERS_RE.test(location) || US_BARE_RE.test(location) || US_STATE_NAME_RE.test(location);
  if (location && NON_US_MARKERS_RE.test(location) && !hasUsSignal) return false;

  if (job.is_remote_us === true) return true;

  if (job.country && /^(us|usa|united states)$/i.test(String(job.country).trim())) {
    return true;
  }

  if (!location) return false;

  if (US_MARKERS_RE.test(location)) return true;
  if (US_BARE_RE.test(location)) return true;
  if (US_STATE_NAME_RE.test(location)) return true;

  const abbrMatch = location.match(US_STATE_ABBR_RE);
  if (abbrMatch && US_STATE_ABBR.has(abbrMatch[1])) return true;

  return false;
}

// Big US job markets that boards often name without a state ("San
// Francisco", "NYC", "Remote - Seattle"). Names shared with a large foreign
// city (Cambridge, Manchester, Birmingham, Dublin) are left out.
const US_CITY_RE = new RegExp(
  "\\b(?:" +
    [
      "San Francisco", "SF Bay Area", "Bay Area", "Silicon Valley", "NYC", "New York City",
      "Seattle", "Bellevue", "Redmond", "Austin", "Boston", "Chicago", "Los Angeles",
      "Denver", "Boulder", "Atlanta", "Miami", "Dallas", "Houston", "San Antonio",
      "Phoenix", "Scottsdale", "Pittsburgh", "Philadelphia", "San Diego", "San Jose",
      "Palo Alto", "Mountain View", "Menlo Park", "Sunnyvale", "Santa Clara",
      "Redwood City", "Oakland", "Berkeley", "Raleigh", "Durham", "Salt Lake City",
      "Lehi", "Minneapolis", "Detroit", "Nashville", "Columbus", "Cincinnati",
      "Cleveland", "St\\.? Louis", "Kansas City", "Indianapolis", "Charlotte", "Tampa",
      "Orlando", "Sacramento", "Las Vegas", "Baltimore", "Reston", "McLean", "Herndon",
      "Irvine", "Santa Monica", "Brooklyn", "Manhattan", "Jersey City", "Hoboken",
      "Stamford", "Portland",
    ].join("|") +
    ")\\b",
  "i",
);

// Foreign cities and country codes that show up alone in board location
// strings ("London", "Bangalore, IND", "Zürich, CH"). Two-letter codes that
// are also US state abbreviations (CA, IN, DE, IL, ...) are left out.
const NON_US_PLACE_RE = new RegExp(
  "(?:^|[^\\p{L}])(?:" +
    [
      "London", "Toronto", "Vancouver", "Montr[eé]al", "Ottawa", "Calgary", "Edmonton",
      "Waterloo", "Kitchener", "Ontario", "Qu[eé]bec", "British Columbia", "Alberta",
      "Amsterdam", "Rotterdam", "Utrecht", "Eindhoven", "Berlin", "Munich", "M[uü]nchen",
      "Hamburg", "Frankfurt", "Cologne", "K[oö]ln", "Stuttgart", "D[uü]sseldorf", "Paris",
      "Lyon", "Brussels", "Antwerp", "Dublin", "Cork", "Galway", "Belfast", "Edinburgh",
      "Glasgow", "Cardiff", "Bristol", "Leeds", "Milan", "Rome", "Madrid", "Barcelona",
      "Valencia", "Lisbon", "Porto", "Z[uü]rich", "Geneva", "Lausanne", "Vienna",
      "Stockholm", "Malm[oö]", "Gothenburg", "Copenhagen", "Aarhus", "Oslo", "Helsinki",
      "Tallinn", "Riga", "Vilnius", "Warsaw", "Krak[oó]w", "Wroc[lł]aw", "Gda[nń]sk",
      "Pozna[nń]", "Prague", "Brno", "Budapest", "Bucharest", "Cluj", "Timi[sș]oara",
      "Sofia", "Belgrade", "Novi Sad", "Zagreb", "Ljubljana", "Kyiv", "Kiev", "Lviv",
      "Istanbul", "Tel Aviv", "Herzliya", "Haifa", "Jerusalem", "Dubai", "Abu Dhabi",
      "Riyadh", "Doha", "Kuwait", "Cairo", "Lagos", "Nairobi", "Cape Town", "Johannesburg",
      "Bangalore", "Bengaluru", "Hyderabad", "Pune", "Chennai", "Mumbai", "Delhi",
      "Gurgaon", "Gurugram", "Noida", "Kolkata", "Ahmedabad", "Mohali", "Lucknow",
      "Jaipur", "Kochi", "Coimbatore", "Karachi", "Lahore", "Islamabad", "Dhaka",
      "Colombo", "Kuala Lumpur", "Jakarta", "Bangkok", "Manila", "Ho Chi Minh", "Hanoi",
      "Hong Kong", "Shanghai", "Beijing", "Shenzhen", "Guangzhou", "Hangzhou", "Taipei",
      "Seoul", "Tokyo", "Osaka", "Sydney", "Melbourne", "Brisbane", "Perth", "Auckland",
      "Wellington", "S[aã]o Paulo", "Rio de Janeiro", "Buenos Aires", "Santiago",
      "Bogot[aá]", "Medell[ií]n", "Lima", "Mexico City", "Ciudad de M[eé]xico",
      "Guadalajara", "Monterrey", "Montevideo", "Reykjav[ií]k", "Yerevan", "Tbilisi",
      "Bratislava", "Nicosia", "Limassol", "Costa Rica", "Colombia", "Argentina", "Chile",
      "Peru", "Uruguay", "Bulgaria", "Hungary", "Croatia", "Slovakia", "Slovenia",
      "Turkey", "T[uü]rkiye", "Egypt", "Nigeria", "Kenya", "South Africa", "Saudi Arabia",
      "Qatar", "Pakistan", "Bangladesh", "Sri Lanka", "Vietnam", "Thailand", "Malaysia",
      "Indonesia", "Taiwan", "Korea", "ANZ",
    ].join("|") +
    ")(?![\\p{L}])",
  "iu",
);
// ISO country codes after a comma: "Pune, IND", "Dublin, IE".
const NON_US_CODE_RE =
  /,\s*(?:IND|JPN|SGP|GBR|DEU|FRA|NLD|ESP|POL|PRT|BRA|MEX|AUS|NZL|KOR|HKG|CHN|TWN|ISR|IRL|CHE|SWE|NOR|DNK|FIN|AUT|BEL|CZE|ROU|BGR|UKR|SRB|GRC|TUR|ARE|ZAF|PHL|IDN|MYS|THA|VNM|CHL|COL|PER|URY|CRI|ARG|CAN|IE|CH|GB|NL|ES|PL|PT|BR|MX|AU|NZ|SG|JP|KR|HK|FR|SE|NO|DK|FI|AT|BE|CZ|RO|BG|UA|RS|GR|TR|AE|ZA|PH|MY|TH|VN|TW|CN|CL|PE|UY|CR)\b/;

/**
 * US or not, from a board's location string alone (no description to read):
 * true for a US place, false for a foreign one, null when the string doesn't
 * say ("Remote", "Hybrid", "In-Office", empty). A string naming both, like
 * "London or New York, NY", counts as US.
 *
 * @param {string} location
 * @returns {boolean|null}
 */
export function usFromLocation(location) {
  const loc = String(location || "").trim();
  if (!loc) return null;
  if (isUsJob({ location: loc }) || US_CITY_RE.test(loc)) return true;
  // "Remote - TX; Remote - GA". CA is skipped: it is as often Canada here.
  for (const m of loc.matchAll(/\b(?:Remote|Hybrid)\s*[-–:]\s*([A-Z]{2})\b/g)) {
    if (m[1] !== "CA" && US_STATE_ABBR.has(m[1])) return true;
  }
  if (NON_US_MARKERS_RE.test(loc) || NON_US_PLACE_RE.test(loc) || NON_US_CODE_RE.test(loc)) return false;
  return null;
}

// Listings that are not a real employer's job, found in the aggregator feeds
// (Jooble relays Lensa, Nexxt, Appcast, ...):
//   - paid job-listing services (the apply link leads to a subscription)
//   - "on behalf of a partner company" relays that hide the employer
//   - relays whose company field names someone other than the employer in
//     the text ("Energy Innovation: Policy and Technology LLC" on 74 jobs
//     whose snippets read "Illinois Tool Works needs a Security Engineer")
// IT staffing firms (Diverse Lynx, Samprasoft, ...) are real employers of
// contractors and are NOT listed here.

const RESELLER_COMPANIES = [
  /^virtual vocations\b/i,
  /^jobgether\b/i,
  /^energy innovation: policy and technology\b/i,
];

const RESELLER_TEXT = [
  /\blisted on behalf of a partner company\b/i,
  /\bsubscribe (?:now )?to (?:view|apply|unlock)\b/i,
];

export function isResellerListing({ company = "", description = "" } = {}) {
  const name = String(company).trim();
  return RESELLER_COMPANIES.some((re) => re.test(name)) || RESELLER_TEXT.some((re) => re.test(String(description)));
}

export default isResellerListing;

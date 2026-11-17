/**
 * Extract the minimum required years of experience from a job description.
 * Returns 0 if no reliable requirement is found.
 *
 * Rewritten 2026-11-17. The previous version needed the word "experience"
 * right after "N years", so it missed most real phrasings and left min_years
 * at 0 on about 3,600 live jobs that state one:
 *   "At least 8 years total combined related work experience"
 *   "Minimum of 5 years work relevant experience"
 *   "2 years of hands on experience", "Minimum 6 years of product management"
 *   "6-10 yrs related experience", "4+ yrs", "Three (3) years of ..."
 *
 * How it works: numbers written as words become digits, every "N years" /
 * "N+ yrs" / "N-M years" mention is found, and a mention counts when the
 * words around it say it is a requirement (at least / minimum / of ...
 * experience / in a role ...) and not something else (company age, legal age,
 * "built 20 years ago"). The LARGEST requirement wins: the overall one is the
 * biggest number, and skill-specific ones are smaller ("8 years overall, 3
 * years of Dynamics"), wherever they appear in the text.
 */

const MAX_PLAUSIBLE_YEARS = 20;

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};
const WORD_RE = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})\\b`, "gi");

function normalize(text) {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#43;|&plus;/gi, "+")
    .replace(/&nbsp;|&#xa0;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&apos;|&#39;|&rsquo;/gi, "'")
    .replace(/[–—]/g, "-")
    .replace(WORD_RE, (w) => String(WORD_NUMBERS[w.toLowerCase()]))
    // "five (5) years" -> "5 (5) years" -> "5 years"
    .replace(/\b(\d+)\s*\(\s*\1\s*\)/g, "$1")
    .replace(/\s+/g, " ");
}

// N years / N+ years / N or more years / N-M years / N to M years.
const MENTION = /\b(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|to)\s*\d{1,2}\s*\+?\s*)?(?:or more\s+|or greater\s+)?(?:years?|yrs?)\b(?:['’]s?)?/gi;

// Words just BEFORE the mention that make it a requirement.
// ("over"/"more than" are not here: "more than 20 years of ... innovation" is
// company history. They count only when experience words follow, below.)
const BEFORE_OK = /(at least|minimum(?: of)?|min\.?|a minimum of|requires?|required|must have|should have|with|have|having|bring|possess|plus)\s*$/i;
// Words just AFTER the mention that make it a requirement.
const AFTER_OK = /^\s*(?:of\s+)?(?:\w+[\s,/&-]+){0,6}?(?:experience|exp\b|expertise|background|track record|work(?:ing)?\b|professional|industry|hands[\s-]?on|in (?:a|an|the)\b|in\s+\w+|as an?\b|developing|building|designing|managing|leading|programming|engineering|administ|supporting|delivering|post[\s-]?graduate)/i;
// Not a requirement: company age, legal age, history, timelines.
const AFTER_BAD = /^\s*(?:of age|old\b|ago\b|in business|of (?:history|innovation|service to|serving|experience (?:serving|providing|delivering|helping))|of (?:our|its|their) )/i;
// A bare "for" is NOT here: "What We Look For 7+ years of ..." is the most
// common requirement heading.
const BEFORE_BAD = /(for (?:over|more than|nearly|almost|the (?:last|past))|over the (?:last|past)|within the (?:last|past)|in the (?:last|past)|founded|since|celebrat\w*|anniversary|been (?:around|in business) for|history of|\btake|\btook|\bnext)\s*(?:over|more than|nearly|almost)?\s*$/i;

export default function extractExperience(text = "") {
  const content = normalize(text);
  let best = 0;
  for (const m of content.matchAll(MENTION)) {
    const value = Number(m[1]);
    // 0 ("0-1 year", "0 to 3 years") means no minimum; keep looking.
    if (!Number.isFinite(value) || value <= 0 || value > MAX_PLAUSIBLE_YEARS) continue;
    const before = content.slice(Math.max(0, m.index - 30), m.index);
    const after = content.slice(m.index + m[0].length, m.index + m[0].length + 80);
    if (AFTER_BAD.test(after)) continue;
    // "over/more than N years" is a requirement only when experience follows
    // ("over 5 years of experience"), never on its own ("for over 55 years").
    if (BEFORE_BAD.test(before)) continue;
    // "N+ years" / "N or more years" is a requirement in practice ("7+ years
    // operating ...", "(7+ years) working as ..."), once the checks above
    // have ruled out company age and the like.
    const openEnded = /\+|plus|or more|or greater/i.test(m[0]);
    if (openEnded || AFTER_OK.test(after) || BEFORE_OK.test(before)) {
      best = Math.max(best, value);
    }
  }
  return best;
}

export { extractExperience };

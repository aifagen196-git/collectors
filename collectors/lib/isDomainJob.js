import { inferRoleFamily } from "../../vendor/scoreMatch.js";

/**
 * Is this job title the IT work the site lists? Every collector checks this
 * on the raw title, before normalizing or saving, so off-domain postings
 * (cashier, pharmacist, store manager, account executive, ...) never reach
 * the database. On 2026-11-10, 28,495 of the 42,013 live jobs were such
 * postings: the boards of big employers (Kroger on Oracle, Pepsi on iCIMS,
 * gyms on JazzHR) list far more store and plant jobs than IT ones.
 *
 * Two layers:
 *  1. The matcher's own title families (vendor/scoreMatch.js TITLE_FAMILIES),
 *     so "in our domain" means what it means at match time; all but legal
 *     and recruiting, which no area on the site covers.
 *  2. IT titles those families don't name yet, several of them target
 *     domains (config/targetDomains.js): Data Center Technician, IT Support,
 *     QA Automation Engineer, Software Development Engineer, Systems
 *     Administrator. These are kept for keyword search and for candidates
 *     without a role family; the matcher's strict role gate shows them in a
 *     family feed only once TITLE_FAMILIES
 *     (backend/src/services/matching/scoreMatch.js) learns them too.
 */

const EXTRA_IT_TITLE_RE = new RegExp(
  "\\b(?:" +
    [
      "software",
      "firmware",
      "embedded (?:software|engineer|developer|systems?)",
      // "Java Developer", "Network Developer" (Oracle Cloud), "Developer
      // Advocate"; not the business, property or teaching kinds.
      "(?<!business |real estate |land |property |provider network |community |program |product |curriculum |content |course |training |instructional |fund |talent |leadership |sales |market |account |brand |club |resource |relationship |membership |donor |project )developers?",
      "programmers?",
      "sdet",
      "sde",
      "data ?cent(?:er|re)s?",
      "help ?desk",
      "service ?desk(?! clerk)",
      "desktop support",
      "technical support",
      "tech support",
      "end user (?:support|computing|services)",
      "systems? (?:administrator|admin|analyst|architect|integration|developer|programmer)",
      // Not the physical kind ("Power Systems Engineer", "Avionics Systems
      // Engineer", "Mission Systems Engineer").
      "(?<!(?:power|fluid|avionics|battery|thermal|mechanical|electrical|propulsion|structures?|structural|mission|vehicle|launch|flight|hvac|weapons?|rf|optical|manufacturing|quality|safety|ground|satellite|spacecraft|aerospace|hydraulic|fuel|engine|payload|harness|energy|controls?|environmental|nuclear|marine|automotive|rail|medical|life support|fire|building|water|process|chemical) )systems? engineer",
      "sysadmin",
      "database",
      "dba",
      "data (?:architect|modell?er|warehouse|governance|steward|management|quality|platform|operations)",
      "network (?:technician|analyst|specialist|architect|operations|security|support)",
      "noc",
      "(?:solutions?|enterprise|technical|security|applications?|integration|infrastructure|platform|systems?|network|software|data|cloud|ai|it|salesforce|devops) architect",
      "applications? (?:analyst|engineer|developer|support|administrator)",
      "engineering manager",
      "(?:director|head|vp|vice president),? (?:of )?engineering",
      "member of (?:the )?technical staff",
      "technical account manager",
      "(?:sales|customer|support|implementation|integration|deployment|escalation|performance) engineer",
      "qa(?!\\/qc)(?! (?:technician|inspector|auditor|coordinator))",
      "quality assurance",
      "quality automation",
      "test automation",
      "automation (?:test|qa)",
      "(?<!controls? |process |industrial |manufacturing |building )automation engineer",
      "software test",
      "scrum master",
      "agile coach",
      "devsecops",
      "cloud",
      "kubernetes",
      "linux",
      "unix",
      // Platforms the site has an area for (Salesforce, ServiceNow, Workday,
      // BI), named in titles like "Workday HCM Lead" or "Power BI Analyst".
      "salesforce",
      "servicenow",
      "workday",
      "power ?bi",
      "tableau",
      "snowflake",
      "informatica",
      "mulesoft",
      "sharepoint",
      "dynamics 365",
      "guidewire",
      "pega",
      "appian",
      "uipath",
      "rpa",
      "(?:oracle|netsuite|dynamics|peoplesoft|erp|crm) (?:developer|consultant|analyst|architect|engineer|administrator|admin|functional|technical)",
      "business systems analyst",
      "cyber",
      "information security",
      "information technology",
      "computer (?:vision|scientist|science|engineer|systems)",
    ].join("|") +
    ")\\b",
  "i",
);

// Machine-shop and plant-floor titles that share a word with IT ones
// ("CNC Programmer", "PLC Programmer", "HVAC Programmer").
const PLANT_FLOOR_RE = /\b(?:cnc|cmm|mastercam|plc|machinist|machining|edm|hvac|welding|robot)\b/i;

// "IT Support", "IT Manager", "SAP FICO Consultant", "ABAP Developer".
// Case-sensitive, so the word "it" (or "sap") doesn't count.
const IT_RE = /\b(?:IT|SAP|ABAP|S\/4 ?HANA|HANA)\b/;

// "Senior AI Systems and Algorithms Engineer", "AI Research Engineer".
const AI_ROLE_RE = /\b(?:AI|ML|LLM|GenAI)\b.*\b(?:engineer|scientist|researcher|developer|architect)\b/i;

// "Staff Engineer, Core Infrastructure", "Principal Engineer - GTM Data
// Platform": at the companies on these boards, a bare senior "Engineer" is a
// software engineer.
const SENIOR_ENGINEER_RE = /^\s*(?:(?:senior|sr\.?|lead|staff|principal|distinguished)\s+)+engineer\b/i;

// The matcher has these families only so that "Recruiter, AI/ML" or "Legal
// Counsel, Supply Chain" isn't read as an AI or supply-chain job; no area on
// the site is legal or recruiting work.
const NOT_IT_FAMILIES = new Set(["legal", "talent-hr"]);

export function isDomainJob(title = "") {
  const family = inferRoleFamily(title);
  if (family) return !NOT_IT_FAMILIES.has(family);
  if (PLANT_FLOOR_RE.test(title)) return false;
  return (
    EXTRA_IT_TITLE_RE.test(title) ||
    IT_RE.test(title) ||
    AI_ROLE_RE.test(title) ||
    SENIOR_ENGINEER_RE.test(title)
  );
}

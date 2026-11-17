// collectors/config/workdayCompanies.js
//
// Workday-hosted career sites the collector scrapes via the internal
// `wday/cxs/{tenant}/{siteId}/jobs` JSON API.
//
// Unlike Greenhouse/BambooHR/Lever, Workday has no public multi-tenant
// discovery mechanism — every company runs its own host shard (wd1, wd5,
// wd12, ...) and an arbitrary siteId with no naming pattern tied to the
// company name. Each entry below was individually verified live (company,
// host, and siteId all confirmed to return real job postings) on 2026-08-04.
// Do not add an entry without verifying it the same way — a wrong siteId
// silently returns "0 jobs found" rather than an error (confirmed with
// Dell's `External` site — Dell's real board turned out to be Oracle
// Recruiting Cloud, so it lives in oracleCompanies.js instead).

const companies = [
  { company: "roberthalf", host: "wd1", siteId: "RobertHalfStaffingCareers" },
  { company: "nvidia", host: "wd5", siteId: "NVIDIAExternalCareerSite" },
  { company: "salesforce", host: "wd12", siteId: "External_Career_Site" },
  { company: "adobe", host: "wd5", siteId: "external_experienced" },
  { company: "mastercard", host: "wd1", siteId: "CorporateCareers" },

  // Added 2026-08-11. Each verified live the same way as the entries above:
  // the cxs `/jobs` endpoint returns a non-zero `total` and a detail fetch on
  // the first `externalPath` returns a populated `jobPostingInfo`. Job counts
  // at time of verification are noted so a future run returning wildly fewer
  // postings is recognisable as a broken siteId rather than a quiet week.
  { company: "target", host: "wd5", siteId: "targetcareers" }, // ~2,000 reqs
  { company: "capitalone", host: "wd12", siteId: "Capital_One" }, // ~1,800 reqs
  // CVS is by far the largest tenant in this list. The collector fetches one
  // detail request per posting, so a full CVS pass is ~19k extra requests —
  // budget for it (or lower DETAIL_CONCURRENCY) before running `npm run all`
  // on a schedule.
  { company: "cvshealth", host: "wd1", siteId: "CVS_Health_Careers" }, // ~19,000 reqs
  // Pfizer's board is global and skews non-US; expect most postings to be
  // dropped by the isUsJob filter rather than saved.
  { company: "pfizer", host: "wd1", siteId: "PfizerCareers" }, // ~540 reqs
  { company: "boeing", host: "wd1", siteId: "EXTERNAL_CAREERS" }, // ~720 reqs

  // Added 2026-09-01, part of the same bulk-volume no-key sweep that found
  // Kroger/Honeywell on Oracle (see SUPPORTED_COMPANIES.md). Verified live:
  // the cxs `/jobs` endpoint returns a non-zero total and a populated first
  // posting.
  { company: "intel", host: "wd1", siteId: "External" }, // ~609 reqs

  // Added 2026-11-10. Each answered the cxs `/jobs` endpoint with postings;
  // the note is how many of the first 20 had IT titles (the only ones the
  // collector keeps), after the total for the big boards. `name` is what job
  // cards show; `company` stays the Workday tenant.
  { company: "amat", host: "wd1", siteId: "External", name: "Applied Materials" }, // 2,000+, 20/20 IT
  { company: "crowdstrike", host: "wd5", siteId: "crowdstrikecareers", name: "CrowdStrike" }, // 19/20
  { company: "kyndryl", host: "wd5", siteId: "KyndrylProfessionalCareers", name: "Kyndryl" }, // 17/20
  { company: "workday", host: "wd5", siteId: "Workday", name: "Workday" }, // 15/20
  { company: "statestreet", host: "wd1", siteId: "Global", name: "State Street" }, // 1,175, 14/20
  { company: "caci", host: "wd1", siteId: "External", name: "CACI" }, // 1,789, 13/20
  { company: "hp", host: "wd5", siteId: "ExternalCareerSite", name: "HP" }, // 13/20
  { company: "motorolasolutions", host: "wd5", siteId: "Careers", name: "Motorola Solutions" }, // 12/20
  { company: "bah", host: "wd1", siteId: "BAH_Jobs", name: "Booz Allen Hamilton" }, // 2,000+, 11/20
  { company: "disney", host: "wd5", siteId: "disneycareer", name: "Disney" }, // 11/20
  { company: "leidos", host: "wd5", siteId: "External", name: "Leidos" }, // 2,000+, 11/20
  { company: "equinix", host: "wd1", siteId: "External", name: "Equinix" }, // 10/20
  { company: "cardinalhealth", host: "wd1", siteId: "EXT", name: "Cardinal Health" }, // 9/20
  { company: "ebay", host: "wd5", siteId: "apply", name: "eBay" }, // 9/20
  { company: "micron", host: "wd1", siteId: "External", name: "Micron" }, // 2,889, 9/20
  { company: "homedepot", host: "wd5", siteId: "CareerDepot", name: "The Home Depot" }, // 8/20
  { company: "paypal", host: "wd1", siteId: "jobs", name: "PayPal" }, // 8/20
  { company: "vanguard", host: "wd5", siteId: "vanguard_external", name: "Vanguard" }, // 8/20
  { company: "accenture", host: "wd103", siteId: "AccentureCareers", name: "Accenture" }, // 2,000+, 7/20
  { company: "blackrock", host: "wd1", siteId: "BlackRock_Professional", name: "BlackRock" }, // 7/20
  { company: "centene", host: "wd5", siteId: "Centene_External", name: "Centene" }, // 7/20
  { company: "fmr", host: "wd1", siteId: "FidelityCareers", name: "Fidelity Investments" }, // 858, 7/20
  { company: "lowes", host: "wd5", siteId: "LWS_External_CS", name: "Lowe's" }, // 13,051, 7/20
  { company: "ngc", host: "wd1", siteId: "Northrop_Grumman_External_Site", name: "Northrop Grumman" }, // 3,623, 7/20
  { company: "zoom", host: "wd5", siteId: "Zoom", name: "Zoom" }, // 7/20
  { company: "analogdevices", host: "wd1", siteId: "External", name: "Analog Devices" }, // 6/20
  { company: "chevron", host: "wd5", siteId: "jobs", name: "Chevron" }, // 6/20
  { company: "ciena", host: "wd5", siteId: "Careers", name: "Ciena" }, // 6/20
  { company: "humana", host: "wd5", siteId: "Humana_External_Career_Site", name: "Humana" }, // 6/20
  { company: "travelers", host: "wd5", siteId: "External", name: "Travelers" }, // 6/20
  { company: "cigna", host: "wd5", siteId: "cignacareers", name: "Cigna" }, // 5/20
  { company: "marvell", host: "wd1", siteId: "MarvellCareers", name: "Marvell" }, // 5/20
  { company: "sonyglobal", host: "wd1", siteId: "SonyGlobalCareers", name: "Sony" }, // 5/20
  { company: "warnerbros", host: "wd5", siteId: "global", name: "Warner Bros. Discovery" }, // 5/20

  // Added 2026-11-18, verified with collectors/verifyWorkday.js: the cxs
  // search answered on this host/siteId; counts are total postings and US IT
  // jobs among the first 100. Boards under 5/100 were left out (AT&T, Labcorp,
  // Amgen, FedEx, Prudential).
  { company: "gdit", host: "wd5", siteId: "External_Career_Site", name: "General Dynamics Information Technology" }, // ~1,317, 67/100
  { company: "fiserv", host: "wd5", siteId: "EXT", name: "Fiserv" }, // ~399, 41/100
  { company: "equifax", host: "wd5", siteId: "External", name: "Equifax" }, // ~173, 34/100
  { company: "fis", host: "wd5", siteId: "SearchJobs", name: "FIS" }, // ~504, 32/100
  { company: "cadence", host: "wd1", siteId: "External_Careers", name: "Cadence Design Systems" }, // ~688, 30/100
  { company: "globalhr", host: "wd5", siteId: "REC_RTX_Ext_Gateway", name: "RTX" }, // ~4,535, 29/100
  { company: "hpe", host: "wd5", siteId: "Jobsathpe", name: "Hewlett Packard Enterprise" }, // ~1,769, 28/100
  { company: "rockwellautomation", host: "wd1", siteId: "External_Rockwell_Automation", name: "Rockwell Automation" }, // ~459, 27/100
  { company: "unisys", host: "wd5", siteId: "External", name: "Unisys" }, // ~437, 26/100
  { company: "mckesson", host: "wd3", siteId: "External_Careers", name: "McKesson" }, // ~653, 25/100
  { company: "relx", host: "wd3", siteId: "relx", name: "RELX" }, // ~759, 24/100
  { company: "thomsonreuters", host: "wd5", siteId: "External_Career_Site", name: "Thomson Reuters" }, // ~529, 24/100
  { company: "gehc", host: "wd5", siteId: "GEHC_ExternalSite", name: "GE HealthCare" }, // ~1,063, 23/100
  { company: "gevernova", host: "wd5", siteId: "Vernova_ExternalSite", name: "GE Vernova" }, // ~2,165, 23/100
  { company: "blueorigin", host: "wd5", siteId: "BlueOrigin", name: "Blue Origin" }, // ~1,901, 23/100
  { company: "transunion", host: "wd5", siteId: "TransUnion", name: "TransUnion" }, // ~212, 22/100
  { company: "kla", host: "wd1", siteId: "Search", name: "KLA" }, // ~1,143, 22/100
  { company: "geaerospace", host: "wd5", siteId: "GE_ExternalSite", name: "GE Aerospace" }, // ~611, 21/100
  { company: "parsons", host: "wd5", siteId: "Search", name: "Parsons" }, // ~1,896, 20/100
  { company: "redhat", host: "wd5", siteId: "jobs", name: "Red Hat" }, // ~161, 20/100
  { company: "broadcom", host: "wd1", siteId: "External_Career", name: "Broadcom" }, // ~414, 19/100
  { company: "trendmicro", host: "wd3", siteId: "External", name: "Trend Micro" }, // ~179, 19/100
  { company: "ptc", host: "wd1", siteId: "PTC", name: "PTC" }, // ~175, 19/100
  { company: "medtronic", host: "wd1", siteId: "MedtronicCareers", name: "Medtronic" }, // ~955, 19/100
  { company: "allstate", host: "wd5", siteId: "allstate_careers", name: "Allstate" }, // ~405, 18/100
  { company: "usbank", host: "wd1", siteId: "US_Bank_Careers", name: "U.S. Bank" }, // ~1,182, 16/100
  { company: "citi", host: "wd5", siteId: "2", name: "Citi" }, // ~2,000, 15/100
  { company: "dxctechnology", host: "wd1", siteId: "DXCJobs", name: "DXC Technology" }, // ~1,341, 15/100
  { company: "gilead", host: "wd1", siteId: "gileadcareers", name: "Gilead Sciences" }, // ~407, 15/100
  { company: "nationwide", host: "wd1", siteId: "Nationwide_Career", name: "Nationwide" }, // ~144, 14/100
  { company: "pnc", host: "wd5", siteId: "External", name: "PNC" }, // ~1,254, 12/100
  { company: "elevancehealth", host: "wd1", siteId: "ANT", name: "Elevance Health" }, // ~258, 12/100
  { company: "3m", host: "wd1", siteId: "Search", name: "3M" }, // ~792, 12/100
  { company: "stryker", host: "wd1", siteId: "StrykerCareers", name: "Stryker" }, // ~1,478, 10/100
  { company: "baxter", host: "wd1", siteId: "baxter", name: "Baxter" }, // ~520, 10/100
  { company: "truist", host: "wd1", siteId: "Careers", name: "Truist" }, // ~1,383, 9/100
  { company: "verizon", host: "wd12", siteId: "verizon-careers", name: "Verizon" }, // ~1,249, 8/100
  { company: "ghr", host: "wd1", siteId: "Lateral-US", name: "Bank of America" }, // ~2,024, 8/100
  { company: "abbott", host: "wd5", siteId: "abbottcareers", name: "Abbott" }, // ~2,000, 8/100
  { company: "pwc", host: "wd3", siteId: "Global_Experienced_Careers", name: "PwC" }, // ~3,683, 7/100
  { company: "nike", host: "wd1", siteId: "nke", name: "Nike" }, // ~694, 6/100
  { company: "aig", host: "wd1", siteId: "aig", name: "AIG" }, // ~390, 6/100
  { company: "iqvia", host: "wd1", siteId: "IQVIA", name: "IQVIA" }, // ~1,930, 6/100
  { company: "gartner", host: "wd5", siteId: "EXT", name: "Gartner" }, // ~801, 5/100
];

export default companies;

// job-engine/vendor/skills.js
//
// SYNCED COPY of backend/src/knowledge/skills.js (aifagen main repo) — see
// job-engine/vendor/scoreMatch.js's header for why this file exists here at
// all. NOT auto-synced; re-copy manually if the backend's skill list
// changes.
//
// SINGLE SOURCE OF TRUTH for skills across the whole system:
//   - the backend matcher (resume vs job scoring)
//   - the backend resume skill extractor
//   - the collectors (import this file directly — see collectors/processors)
//
// It provides three things:
//   1. SKILLS       — the dictionary used to detect skills in free text.
//   2. extractSkills(text) — regex-detect dictionary skills in a blob of text.
//   3. canonical / normalizeSkills — collapse skill variants to one canonical
//      token so "Postgres", "PostgreSQL" and "psql" all compare equal at match
//      time. Both sides of a comparison MUST go through normalizeSkills.

export const SKILLS = [
  // Frontend
  "React", "Next.js", "Vue", "Angular", "JavaScript", "TypeScript", "HTML",
  "CSS", "Tailwind CSS",
  // Backend
  "Node.js", "Express", "NestJS", "Spring Boot", "Django", "Flask",
  // Languages
  "Python", "Java", "C++", "C#", "PHP",
  // Databases
  "MongoDB", "PostgreSQL", "MySQL", "Redis", "SQLite",
  // Cloud
  "AWS", "Azure", "GCP",
  // DevOps
  "Docker", "Kubernetes", "Terraform", "Jenkins", "GitHub Actions",
  // AI/ML
  "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch", "LLM",
  "OpenAI", "NLP", "Computer Vision",
  // Data
  "Power BI", "Tableau", "Excel", "SQL",
  // General
  "GitHub", "REST API", "GraphQL",
  // Supply Chain
  "SAP", "Supply Chain", "Logistics",

  // --- Added: terms already referenced by ALIASES below but previously
  // absent from the detection dictionary, so extractSkills() could never
  // actually find them in raw job/resume text. ---

  // Languages/frameworks
  "Go", "Ruby", "Rails", ".NET", "C#", "SQL Server",
  // General/version control
  "Git", "Linux", "Bash", "Shell Scripting", "Agile", "Scrum", "Kanban",
  // DevOps/data pipeline
  "CI/CD", "Kafka", "Airflow", "Spark", "dbt", "Data Warehouse", "Elasticsearch",
  "Site Reliability Engineering", "SRE",
  // AI/ML
  "Generative AI", "Scikit-learn", "Hugging Face",
  // QA
  "Selenium", "Test Automation", "QA",
  // PM/BA/Supply chain
  "Jira", "Project Management", "Requirements Gathering",
  "Sales and Operations Planning", "Demand Planning", "ERP", "Salesforce",
  // Networking/security
  "Cisco", "Palo Alto", "Fortinet", "Firewall", "VPN", "IPsec", "Cybersecurity",
  "SIEM", "Splunk", "Penetration Testing", "Red Team", "Burp Suite",
  "MITRE ATT&CK", "BGP", "OSPF", "SD-WAN", "Switching", "Routing",

  // --- Added 2026-11-18: the dictionary had 104 entries, almost all
  // development and networking, so jobs in the site's other areas (IT
  // support, sysadmin, data, SAP/Salesforce/ERP, QA, mobile, security
  // compliance) were stored with few or no skills and could not be matched
  // on them. Words that are also everyday English ("Windows", "Office",
  // "Oracle", "Lean") are only listed in an unambiguous product form. ---

  // Languages
  "Kotlin", "Swift", "Scala", "Rust", "Dart", "Perl", "PowerShell", "VBA", "COBOL",
  "TypeScript", "R Programming",
  // Mobile
  "iOS", "Android", "Flutter", "React Native", "Xamarin",
  // Databases
  "Oracle Database", "PL/SQL", "T-SQL", "NoSQL", "Cassandra", "DynamoDB", "DB2",
  "Snowflake", "Redshift", "BigQuery",
  // Data / BI / analytics
  "Databricks", "Hadoop", "Hive", "Informatica", "SSIS", "SSRS", "SSAS", "ETL",
  "Data Modeling", "Looker", "Alteryx", "SAS", "Pandas", "NumPy", "A/B Testing",
  "Data Visualization",
  // AI
  "LangChain", "RAG", "Prompt Engineering", "MLOps",
  // Cloud / DevOps / platform
  "Ansible", "Chef", "Puppet", "Helm", "OpenShift", "CloudFormation", "Prometheus",
  "Grafana", "Datadog", "New Relic", "GitLab", "Bitbucket", "Azure DevOps",
  "Microservices", "RabbitMQ", "Serverless", "Unix",
  // Mainframe
  "Mainframe", "JCL", "CICS",
  // QA
  "Cypress", "Playwright", "JUnit", "TestNG", "Cucumber", "Postman", "JMeter",
  "Appium", "LoadRunner", "API Testing", "Manual Testing", "Performance Testing",
  // IT support / systems administration
  "ServiceNow", "ITIL", "Active Directory", "Windows Server", "Microsoft 365",
  "Exchange Server", "Group Policy", "VMware", "Hyper-V", "Citrix", "Intune", "SCCM",
  "Jamf", "Help Desk", "Desktop Support", "Troubleshooting", "Ticketing",
  // Data center / networking
  "Data Center", "Structured Cabling", "TCP/IP", "DNS", "DHCP", "Juniper", "Aruba",
  "Meraki", "VoIP", "Wireshark", "Load Balancing", "Network Security",
  // Security / compliance / identity
  "Zscaler", "CrowdStrike", "Okta", "IAM", "SSO", "SAML", "OAuth", "Zero Trust",
  "EDR", "Incident Response", "Vulnerability Management", "Nessus", "Qualys",
  "NIST", "ISO 27001", "SOC 2", "HIPAA", "PCI DSS", "GRC", "Risk Assessment",
  // SAP / Salesforce / ERP / low-code
  "ABAP", "SAP FICO", "SAP MM", "SAP SD", "SAP Basis", "Fiori", "Apex",
  "Visualforce", "Lightning Web Components", "SOQL", "Dynamics 365", "NetSuite",
  // Workday only as the product: plain "Workday" is mostly the employer's own
  // name in Workday, Inc. postings ("At Workday, we ...").
  "PeopleSoft", "Workday HCM", "Workday Financials", "Workday Integrations",
  "Workday Studio", "Workday Extend", "Workday Report", "Workday Prism", "Pega", "Appian", "UiPath", "Blue Prism", "MuleSoft",
  "Boomi", "SharePoint", "Power Automate", "Power Apps",
  // Design
  "Figma", "Sketch", "Adobe XD", "User Research", "Wireframing",
  // Supply chain / operations
  "Inventory Management", "Procurement", "Forecasting", "MRP", "WMS", "Six Sigma",
  // PM / BA
  "Confluence", "Stakeholder Management", "Business Analysis", "Process Improvement",
];

// Skill names that are also everyday English words ("go to market",
// "Adobe Express", "Swift delivery"). These only count when written with the
// technology's own capitalisation, and "Go" never when it's "Go-to"/"go to".
// Short acronyms that are also fragments of ordinary words or names ("SAS"
// airline, "Hive" hive mind, "RAG", "IAM" in "I am") count only in capitals.
const CASE_SENSITIVE = new Set([
  "Go", "Express", "Rails", "Swift", "Rust", "Dart", "Chef", "Puppet", "Spark", "Ruby", "Flask",
  "iOS", "SAS", "Hive", "RAG", "IAM", "EDR", "WMS", "MRP", "GRC", "SSO", "DNS", "Apex", "Sketch",
  "Helm",
]);

const EXCLUDE_AFTER = { Go: "(?![- ]?to\\b)" };
const EXCLUDE_BEFORE = {
  Express: "(?<!\\b(?:Adobe|American|Microsoft|Visual Studio|SQL Server) )",
};

function hasCaseSensitive(original, skill) {
  const re = new RegExp(
    `${EXCLUDE_BEFORE[skill] || ""}\\b${skill}\\b${EXCLUDE_AFTER[skill] || ""}`,
  );
  return re.test(original);
}

/** Detect which dictionary skills appear in a blob of text (word-boundary). */
export function extractSkills(text = "") {
  const original = String(text);
  const content = original.toLowerCase();
  const found = [];
  for (const skill of SKILLS) {
    if (CASE_SENSITIVE.has(skill)) {
      if (hasCaseSensitive(original, skill)) found.push(skill);
      continue;
    }
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // \b only matches between a word char and a non-word char. A skill that
    // STARTS or ENDS on a non-word char (C#, C++, .NET) can never satisfy a
    // \b on that side, so that boundary is dropped for such tokens — a
    // lookaround-free way to still require the other side stays word-bounded.
    const leadsWithWordChar = /^\w/.test(skill);
    const endsWithWordChar = /\w$/.test(skill);
    const pattern = `${leadsWithWordChar ? "\\b" : ""}${escaped.toLowerCase()}${endsWithWordChar ? "\\b" : ""}`;
    const regex = new RegExp(pattern, "i");
    if (regex.test(content)) found.push(skill);
  }
  return [...new Set(found)];
}

// Collapse variants to one canonical token. Lowercase, deterministic.
const ALIASES = {
  js: "javascript", ts: "typescript", node: "node.js", nodejs: "node.js",
  golang: "go", "c sharp": "c#", "dot net": ".net", dotnet: ".net",
  postgres: "postgresql", psql: "postgresql", "ms sql": "sql server",
  mssql: "sql server", "power bi": "powerbi",
  "amazon web services": "aws", "google cloud": "gcp",
  "google cloud platform": "gcp", k8s: "kubernetes",
  "terraform iac": "terraform", "github actions": "ci/cd",
  "gitlab ci": "ci/cd", jenkins: "ci/cd",
  "border gateway protocol": "bgp", "open shortest path first": "ospf",
  "sd wan": "sd-wan", "cisco ios": "cisco", "layer 2": "switching",
  "layer 3": "routing", l2: "switching", l3: "routing",
  "pen testing": "penetration testing", pentest: "penetration testing",
  pentesting: "penetration testing", "red teaming": "red team",
  burpsuite: "burp suite", "mitre att&ck": "mitre attack",
  ml: "machine learning", nlp: "natural language processing",
  cv: "computer vision", llms: "llm",

  // Frontend/JS ecosystem (match-line alias set: dotted/undotted variants)
  reactjs: "react", "react.js": "react", "react js": "react",
  nextjs: "next.js", "next js": "next.js", vuejs: "vue", "vue.js": "vue",
  angularjs: "angular", expressjs: "express", "express.js": "express",
  nestjs: "nestjs", "nest.js": "nestjs", "tailwindcss": "tailwind css",
  tailwind: "tailwind css", scss: "sass", html5: "html", css3: "css",
  // Backend/data
  "spring boot": "spring", springboot: "spring", "ruby on rails": "rails",
  mongo: "mongodb", "elastic search": "elasticsearch",
  "microsoft azure": "azure", "ms azure": "azure",
  "google cloud storage": "gcp", ec2: "aws", s3: "aws", lambda: "aws",
  // DevOps/CI (Jobalytics-style synonym groups)
  "ci cd": "ci/cd", cicd: "ci/cd", "continuous integration": "ci/cd",
  "continuous delivery": "ci/cd", "continuous deployment": "ci/cd",
  "circle ci": "ci/cd", circleci: "ci/cd", "travis ci": "ci/cd",
  "infrastructure as code": "terraform", iac: "terraform",
  containerization: "docker", containers: "docker",
  "site reliability": "sre", "site reliability engineering": "sre",
  // AI/ML
  genai: "generative ai", "gen ai": "generative ai",
  "large language model": "llm", "large language models": "llm",
  sklearn: "scikit-learn", "scikit learn": "scikit-learn",
  tf: "tensorflow", "hugging face": "huggingface",
  // Data/BI
  powerbi: "power bi", "ms excel": "excel", "microsoft excel": "excel",
  "google sheets": "excel", pyspark: "spark", "apache spark": "spark",
  "apache kafka": "kafka", "apache airflow": "airflow",
  "data warehousing": "data warehouse", dbt: "dbt",
  // BA / PM / supply chain
  "ms project": "project management", "jira software": "jira",
  "user stories": "requirements gathering", "user story": "requirements gathering",
  "s&op": "sales and operations planning", sop: "sales and operations planning",
  "demand planning": "demand planning", "erp systems": "erp", "sap erp": "sap",
  "sap s/4hana": "sap", "sap s4hana": "sap", s4hana: "sap",
  // QA
  "quality assurance": "qa", "automation testing": "test automation",
  "automated testing": "test automation", "selenium webdriver": "selenium",
  // Networking/security
  "cisco routers": "cisco", "cisco switches": "cisco", "palo alto networks": "palo alto",
  "checkpoint firewall": "firewall", "fortinet fortigate": "fortinet",
  "vpn tunnels": "vpn", "ip sec": "ipsec", "cyber security": "cybersecurity",
  "information security": "cybersecurity", infosec: "cybersecurity",
  siem: "siem", "splunk enterprise": "splunk",
  // General
  "restful api": "rest api", "restful apis": "rest api", "rest apis": "rest api",
  restful: "rest api", "api development": "rest api",
  "version control": "git", "agile methodologies": "agile", scrum: "agile",
  "agile scrum": "agile", kanban: "agile",
  // Added 2026-11-18 with the dictionary expansion
  "office 365": "microsoft 365", o365: "microsoft 365", m365: "microsoft 365",
  "ms 365": "microsoft 365", "service now": "servicenow", snow: "servicenow",
  vsphere: "vmware", esxi: "vmware", "vmware vsphere": "vmware",
  "react-native": "react native", tsql: "t-sql", plsql: "pl/sql", "pl sql": "pl/sql",
  "oracle db": "oracle database", "oracle dba": "oracle database",
  lwc: "lightning web components", sfdc: "salesforce", "salesforce apex": "apex",
  d365: "dynamics 365", "dynamics crm": "dynamics 365", "microsoft dynamics": "dynamics 365",
  "sap abap": "abap", "sap fiori": "fiori", "sap basis administration": "sap basis",
  powerapps: "power apps", "microsoft power apps": "power apps",
  "microsoft power automate": "power automate", "ms flow": "power automate",
  iso27001: "iso 27001", soc2: "soc 2", "soc ii": "soc 2", pci: "pci dss",
  "identity and access management": "iam", "single sign-on": "sso", "single sign on": "sso",
  "endpoint detection and response": "edr", "ab testing": "a/b testing",
  "a/b tests": "a/b testing", "rest assured": "api testing", "load testing": "performance testing",
  "help-desk": "help desk", helpdesk: "help desk", "service desk": "help desk",
  "desktop support": "desktop support", "ad ds": "active directory",
  "gitlab ci/cd": "ci/cd", "azure pipelines": "azure devops", ado: "azure devops",
  "aws cloudformation": "cloudformation", "google bigquery": "bigquery",
  "amazon redshift": "redshift", "apache hive": "hive", "apache hadoop": "hadoop",
  "data modelling": "data modeling", "etl/elt": "etl", elt: "etl",
  "retrieval augmented generation": "rag", "retrieval-augmented generation": "rag",
  "ml ops": "mlops", "voice over ip": "voip", "tcp ip": "tcp/ip",
  "workday hcm": "workday", "workday financials": "workday", "workday integrations": "workday",
  "workday studio": "workday", "workday extend": "workday", "workday report": "workday",
  "workday prism": "workday",
};

// Suffix stripping (Jobalytics pattern): "scripting"→"script", "testing" stays
// (dictionary word), but "dockerized"→"docker" style variants collapse. Only
// applied when the STRIPPED form is a known alias key or canonical value —
// blind stemming ("aws"→"aw") would corrupt more than it fixes.
const KNOWN_CANONICALS = new Set(Object.values(ALIASES));
const SUFFIXES = ["ing", "ed", "es", "s"];

function stripSuffix(key) {
  for (const suf of SUFFIXES) {
    if (key.length > suf.length + 3 && key.endsWith(suf)) {
      const base = key.slice(0, -suf.length);
      if (ALIASES[base] || KNOWN_CANONICALS.has(base)) return base;
    }
  }
  return key;
}

export function canonical(skill = "") {
  let key = String(skill)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[“”"']/g, "");
  if (!ALIASES[key]) key = stripSuffix(key);
  return ALIASES[key] || key;
}

export function normalizeSkills(skills = []) {
  const out = new Set();
  for (const s of skills) {
    if (!s) continue;
    out.add(canonical(s));
  }
  return [...out];
}

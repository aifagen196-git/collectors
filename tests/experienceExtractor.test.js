// node tests/experienceExtractor.test.js
// Phrasings taken from live postings (2026-11-17).
import assert from "node:assert/strict";
import extractExperience from "../processors/experienceExtractor.js";

const CASES = [
  ["Basic Qualifications: At least 8 years total combined related work experience and completion", 8],
  ["Good in Core Java – Should have at least 2 years development experience", 2],
  ["Minimum of 5 years work relevant experience required.", 5],
  ["Bachelor's degree with 2 years of technical and/or engineering, Logistics", 2],
  ["• 2 years of hands on experience with cloud technologies", 2],
  ["At least 2 years of professional experience performing analysis", 2],
  ["Minimum of 3 years of client facing work experience developing Java", 3],
  ["What We're Looking For At least 5 years of research or engineering experience building AI", 5],
  ["STEM discipline and 5 years of engineering experience in a professional environment", 5],
  ["<li>Minimum 6 years of product management or adjacent product-building</li>", 6],
  ["Bachelor's Degree, with 6-10 yrs related information systems experience. 4&#43; years", 6],
  ["At least 5 years of professional Salesforce development experience", 5],
  ["Secret security clearance• 10 years of position-relevant experience• Bachelor's", 10],
  ["Three (3) years of experience administering Linux servers", 3],
  ["Requires five or more years in a software engineering role", 5],
  ["You have 4+ yrs building data pipelines", 4],
  ["5+ years' experience with Kubernetes", 5],
  ["3-5 years of experience in data analysis", 3],
  ["What We Look For 7+ years of professional software engineering experience", 7],
  ["Skills We're Looking For 8+ years of software engineering experience", 8],
  ["What we're looking for 6+ years experience in the software industry", 6],
  ["What You'll Bring to the Team: 7+ years operating enterprise physical security systems", 7],
  ["BA/BS degree. 8+ years of experience with large ERP systems is required. 3-5 years of Oracle Fusion", 8],
  ["Proven experience (7+ years) working as a Machine Learning Engineer", 7],
  ["· 5+ years&apos; experience with RDBMS such as SQL Server", 5],
  ["an entry-level role ideal for candidates with 0–1 year of experience", 0],
  ["Qualifications 10+ years of technical program management or infrastructure", 10],
  // Not requirements.
  ["Our client has been in business for over 100 years and remains a leader", 0],
  ["For over 55 years ASM has been ahead of what's next", 0],
  ["Must be at least 18 years of age or older. High school diploma", 0],
  ["Dell Technologies has delivered HPC solutions for 25+ years, including", 0],
  ["We shaped the internet for the better over the last 25 years.", 0],
  ["vs discuss the most elegant idea that will take 5 years to realize.", 0],
  ["companies running on software products built 20 years ago.", 0],
  ["a federal contractor with more than 30 years of experience providing environmental services", 0],
  ["Founded 12 years ago, we are a growing team", 0],
  ["No experience required.", 0],
  ["Building on more than 20 years of electro-optical and infrared systems innovation", 0],
  ["with a polygraph completed within the last seven years", 0],
];

let failed = 0;
for (const [text, want] of CASES) {
  const got = extractExperience(text);
  if (got !== want) {
    failed++;
    console.error(`FAIL want ${want} got ${got}: ${text}`);
  }
}
assert.equal(failed, 0, `${failed} of ${CASES.length} cases failed`);
console.log(`experienceExtractor: ${CASES.length} cases pass`);

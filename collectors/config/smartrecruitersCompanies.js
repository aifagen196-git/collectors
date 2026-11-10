// collectors/config/smartrecruitersCompanies.js
//
// The smartrecruiters list lives in config/smartrecruitersCompanies.js, the file collectors/smartrecruiters.js
// reads (rebuilt by `node collectors/verifyBoards.js smartrecruiters`). This re-export
// keeps the older verify scripts and supportedCompanies.js on the same list.
export { default } from "../../config/smartrecruitersCompanies.js";

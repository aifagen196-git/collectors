// collectors/config/ashbyCompanies.js
//
// The ashby list lives in config/ashbyCompanies.js, the file collectors/ashby.js
// reads (rebuilt by `node collectors/verifyBoards.js ashby`). This re-export
// keeps the older verify scripts and supportedCompanies.js on the same list.
export { default } from "../../config/ashbyCompanies.js";

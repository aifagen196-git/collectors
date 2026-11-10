// collectors/config/leverCompanies.js
//
// The lever list lives in config/leverCompanies.js, the file collectors/lever.js
// reads (rebuilt by `node collectors/verifyBoards.js lever`). This re-export
// keeps the older verify scripts and supportedCompanies.js on the same list.
export { default } from "../../config/leverCompanies.js";

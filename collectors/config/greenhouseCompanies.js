// collectors/config/greenhouseCompanies.js
//
// The greenhouse list lives in config/greenhouseCompanies.js, the file collectors/greenhouse.js
// reads (rebuilt by `node collectors/verifyBoards.js greenhouse`). This re-export
// keeps the older verify scripts and supportedCompanies.js on the same list.
export { default } from "../../config/greenhouseCompanies.js";

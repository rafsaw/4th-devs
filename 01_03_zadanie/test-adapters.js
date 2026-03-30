// Quick manual test for infrastructure adapters — no LLM involved.
// Run: node --env-file=.env test-adapters.js

import { checkPackage } from "./src/checkPackage.js";
import { redirectPackage } from "./src/redirectPackage.js";

console.log("--- checkPackage ---");
console.log(await checkPackage("PKG-001").catch(e => ({ error: e.message })));

console.log("\n--- redirectPackage ---");
console.log(await redirectPackage("PKG-007", "WRO-01", "AUTH123").catch(e => ({ error: e.message })));

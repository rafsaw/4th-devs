import { zmailHelp, zmailGetInbox } from "./zmail.js";

async function main() {
  console.log("=== help ===");
  const help = await zmailHelp();
  console.log(typeof help === "string" ? help : JSON.stringify(help, null, 2));

  console.log("\n=== getInbox page=1 ===");
  const inbox = await zmailGetInbox(1);
  console.log(typeof inbox === "string" ? inbox : JSON.stringify(inbox, null, 2));
}

main().catch((e) => {
  console.error("smoke failed:", e);
  process.exit(1);
});

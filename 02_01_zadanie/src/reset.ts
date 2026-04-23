import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config.js";
import { HubClient } from "./hubClient.js";
import { SessionStateManager } from "./stateManager.js";

async function main(): Promise<void> {
  loadDotenv({ path: resolve(process.cwd(), ".env"), override: false });
  loadDotenv({ path: resolve(process.cwd(), "..", ".env"), override: false });

  const config = loadConfig("REMOTE_EXPERIMENT");
  const stateDir = resolve(process.cwd(), config.stateDir);
  const stateManager = new SessionStateManager(stateDir);
  const hubClient = new HubClient(config);

  console.log("1. Sending reset to hub...");
  const result = await hubClient.reset();
  console.log(`   Hub response: ${result.rawResponse}`);

  console.log("2. Zeroing local budget_state.json...");
  await stateManager.saveBudget({
    spentPp: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    requests: 0,
    resets: 1
  });

  console.log("\nReset complete. Budget: 0.0000 PP. Ready to run remote-experiment.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

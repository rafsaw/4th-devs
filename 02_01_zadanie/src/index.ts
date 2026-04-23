import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config.js";
import { ExperimentRunner } from "./experimentRunner.js";
import { SessionStateManager } from "./stateManager.js";
import { TraceLogger } from "./traceLogger.js";
import type { Mode } from "./types.js";

function parseModeFromArgv(): Mode | undefined {
  const argv = process.argv;
  // Support both --mode=VALUE and --mode VALUE formats.
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--mode=")) {
      value = argv[i].split("=")[1];
      break;
    }
    if (argv[i] === "--mode" && argv[i + 1]) {
      value = argv[i + 1];
      break;
    }
  }
  if (!value) return undefined;
  if (value === "SAFE_LOCAL" || value === "REMOTE_EXPERIMENT") return value;
  throw new Error(`Invalid mode: ${value}`);
}

async function main(): Promise<void> {
  // Load .env from project first, then repo root. Existing process env wins.
  loadDotenv({ path: resolve(process.cwd(), ".env"), override: false });
  loadDotenv({ path: resolve(process.cwd(), "..", ".env"), override: false });

  const mode = parseModeFromArgv();
  const config = loadConfig(mode);
  const stateDir = resolve(process.cwd(), config.stateDir);
  await mkdir(stateDir, { recursive: true });

  const runner = new ExperimentRunner({
    config,
    stateManager: new SessionStateManager(stateDir),
    trace: new TraceLogger(stateDir)
  });

  await runner.run();
  console.log(`Run finished in mode=${config.mode}. Check ${config.stateDir}/*.json* files.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

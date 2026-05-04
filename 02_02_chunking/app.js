/**
 * Runs chunking strategies on the configured source file
 * and saves results as JSONL to workspace/example-[type].jsonl
 *
 * Usage:
 *   node app.js              — all four strategies
 *   node app.js --topics     — topics only (single LLM call)
 * From repo root: npm run lesson7:chunking:topics (avoid npm run … -- --topics; npm may swallow --topics)
 */

import { createInterface } from "node:readline/promises";
import { readFile, writeFile } from "fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkByCharacters } from "./src/strategies/characters.js";
import { chunkBySeparators } from "./src/strategies/separators.js";
import { chunkWithContext } from "./src/strategies/context.js";
import { chunkByTopics } from "./src/strategies/topics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_REL = "workspace/s02e01-zarzadzanie-kontekstem-w-konwersacji-1773309011.md";
const INPUT = path.join(__dirname, INPUT_REL);
const DEMO_DIR = "workspace/";

const topicsOnly = process.argv.slice(2).includes("--topics");

const confirmRun = async () => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  if (topicsOnly) {
    console.log("\n⚠️  UWAGA: Tryb --topics zużyje tokeny (jedna duża odpowiedź LLM).");
  } else {
    console.log("\n⚠️  UWAGA: Uruchomienie tego przykładu zużyje tokeny (strategie context i topics używają LLM).");
  }
  console.log("   Jeśli nie chcesz uruchamiać go teraz, najpierw sprawdź gotowe wyniki:");
  console.log(`   Demo: ${DEMO_DIR}example-*.jsonl`);
  console.log("");

  const answer = await rl.question("Czy chcesz kontynuować? (yes/y): ");
  rl.close();

  const normalized = answer.trim().toLowerCase();
  if (normalized !== "yes" && normalized !== "y") {
    console.log("Przerwano.");
    process.exit(0);
  }
};

const toJsonl = (chunks) =>
  chunks.map((chunk) => JSON.stringify(chunk)).join("\n");

const save = async (name, chunks) => {
  const outPath = path.join(__dirname, "workspace", `example-${name}.jsonl`);
  await writeFile(outPath, toJsonl(chunks), "utf-8");
  console.log(`  ✓ ${path.relative(__dirname, outPath)} (${chunks.length} chunks)`);
};

const main = async () => {
  await confirmRun();
  const text = await readFile(INPUT, "utf-8");
  const opts = { source: INPUT_REL };
  console.log(`Source: ${INPUT_REL} (${text.length} chars)\n`);

  if (topicsOnly) {
    console.log("Topics (AI-driven) only...");
    await save("topics", await chunkByTopics(text, opts));
  } else {
    console.log("1. Characters...");
    await save("characters", chunkByCharacters(text));

    console.log("2. Separators...");
    await save("separators", chunkBySeparators(text, opts));

    console.log("3. Context (LLM-enriched)...");
    await save("context", await chunkWithContext(text, opts));

    console.log("4. Topics (AI-driven)...");
    await save("topics", await chunkByTopics(text, opts));
  }

  console.log("\nDone.");
};

main().catch(console.error);

#!/usr/bin/env node
/**
 * S03E01 — port z `spec/s03e01.py`
 * Dwufazowo: normy programowe + klasyfikacja notatek (OpenRouter + CHEAP_MODEL / Haiku).
 */

import AdmZip from "adm-zip";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { readAppEnv } from "./loadEnv.js";
import { findAllErrorNotes } from "./openrouter.js";
import { hasDataAnomaly } from "./sensors.js";

let totalPromptTokens = 0;
let totalCompletionTokens = 0;
let totalLlmCalls = 0;
let totalLlmTimeMs = 0;

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const names = await readdir(dir, { withFileTypes: true });
  for (const ent of names) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walkFiles(p)));
    else out.push(p);
  }
  return out;
}

async function main(): Promise<unknown> {
  const env = readAppEnv();

  console.log(`🔧 Model LLM (CHEAP_MODEL): ${env.cheapModel}`);

  const tmpDir = await mkdtemp(path.join(tmpdir(), "sensors-"));
  const zipPath = path.join(tmpDir, "sensors.zip");

  try {
    console.log(`\n⬇  Pobieram dane z ${env.sensorsZipUrl} ...`);
    const zipRes = await fetch(env.sensorsZipUrl);
    if (!zipRes.ok) {
      throw new Error(`Download failed: HTTP ${zipRes.status}`);
    }
    const buf = Buffer.from(await zipRes.arrayBuffer());
    await writeFile(zipPath, buf);
    console.log(`   Pobrano: ${Math.floor(buf.length / 1024)} KB`);

    console.log("📦 Rozpakowuję ...");
    new AdmZip(buf).extractAllTo(tmpDir, true);

    const allFiles = await walkFiles(tmpDir);
    const jsonFiles = allFiles
      .filter((f) => f.endsWith(".json"))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    console.log(`📂 Pliki JSON: ${jsonFiles.length}`);

    console.log("\n🔍 Pass 1: analiza programistyczna ...");
    const dataAnomalies = new Set<string>();
    const goodDataNotes = new Map<string, string>();

    for (const filepath of jsonFiles) {
      const filename = path.basename(filepath);
      const fileId = filename.replace(/\.json$/i, "");

      const raw = await readFile(filepath, "utf8");
      const data = JSON.parse(raw) as Record<string, unknown>;

      if (hasDataAnomaly(data)) {
        dataAnomalies.add(fileId);
      } else {
        const note = String(data.operator_notes ?? "").trim();
        goodDataNotes.set(fileId, note);
      }
    }

    console.log(`   🔴 Anomalie danych: ${dataAnomalies.size}`);
    console.log(`   ✅ Pliki z poprawnymi danymi: ${goodDataNotes.size}`);

    console.log("\n🔍 Pass 2: klasyfikacja notatek operatora (LLM) ...");
    const noteToIds = new Map<string, string[]>();
    for (const [fileId, note] of goodDataNotes) {
      const ids = noteToIds.get(note);
      if (ids) ids.push(fileId);
      else noteToIds.set(note, [fileId]);
    }

    console.log(`   Unikalne notatki do klasyfikacji: ${noteToIds.size}`);

    const noteAnomalies = await findAllErrorNotes(
      noteToIds,
      env.openrouterApiKey,
      env.cheapModel,
      200,
      (promptIn, completionOut, elapsedMs) => {
        totalPromptTokens += promptIn;
        totalCompletionTokens += completionOut;
        totalLlmCalls += 1;
        totalLlmTimeMs += elapsedMs;
      },
    );
    console.log(`   🔴 Pliki z anomalią notatki: ${noteAnomalies.size}`);

    const allAnomalies = [...new Set([...dataAnomalies, ...noteAnomalies])].sort();
    console.log(`\n🎯 Łącznie anomalii: ${allAnomalies.length}`);
    if (allAnomalies.length) {
      console.log(`   Przykłady: ${allAnomalies.slice(0, 5).join(", ")} ...`);
    }

    const verifyPayload = {
      apikey: env.ag3ntsApiKey,
      task: "evaluation",
      answer: { recheck: allAnomalies },
    };

    console.log(`\n📤 Wysyłam do ${env.verifyUrl} ...`);
    const snippet = `${JSON.stringify(verifyPayload).slice(0, 200)} ...`;
    console.log(`   Payload (fragment): ${snippet}`);

    const vr = await fetch(env.verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verifyPayload),
    });

    const resultText = await vr.text();
    let result: unknown;
    try {
      result = JSON.parse(resultText) as unknown;
    } catch {
      result = resultText;
    }

    if (!vr.ok) {
      console.error(`   HTTP ${vr.status} blad: ${resultText}`);
      throw new Error(`Verify failed: HTTP ${vr.status}`);
    }

    console.log(`📨 Odpowiedź centrali: ${JSON.stringify(result)}`);

    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const avgTokensPerCall =
      totalLlmCalls > 0 ? Math.floor(totalTokens / totalLlmCalls) : 0;

    console.log();
    console.log("=== OBSERVABILITY SUMMARY ===");
    console.log(`LLM calls:         ${totalLlmCalls}`);
    console.log(`Tokens in:         ${totalPromptTokens} (prompt)`);
    console.log(`Tokens out:        ${totalCompletionTokens} (completion)`);
    console.log(`Tokens total:      ${totalTokens}`);
    console.log(`Avg tokens/call:   ${avgTokensPerCall}`);
    console.log(`Total LLM time:    ${totalLlmTimeMs} ms`);
    console.log("=============================");

    return result;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../output");
const FLAG_TXT_PATH = path.join(OUTPUT_DIR, "FLG.txt");

export const createRunTrace = (config) => ({
  startedAt: new Date().toISOString(),
  provider: config.provider,
  model: config.model,
  note: "Trace pokazuje wejscie/wyjscie modelu i drone API. Klucz API jest zamaskowany. Map analyst: kazda proba ma request i responseText. Drone operator: baselineCandidates to szablon z kodu (bez LLM); iterations — llmInvolved false przy probie 1 (baseline), true gdy model generuje plan; przy sukcesie wylacznie na baseline planningNotes wyjasnia brak LLM.",
  mapAnalyst: {
    attempts: []
  },
  droneOperator: {
    baselineCandidates: [],
    iterations: []
  }
});

export const saveTrace = async (trace, { sector, flag, attempts }) => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const full = {
    ...trace,
    finishedAt: new Date().toISOString(),
    result: {
      sector: sector ?? null,
      flag: flag ?? null,
      totalAttempts: attempts?.length ?? 0
    }
  };
  const filePath = path.join(OUTPUT_DIR, `run-${stamp}.json`);
  await writeFile(filePath, JSON.stringify(full, null, 2), "utf8");
  return filePath;
};

export const saveFlagTxt = async (flag) => {
  if (!flag || typeof flag !== "string") {
    return null;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(FLAG_TXT_PATH, `${flag.trim()}\n`, "utf8");
  return FLAG_TXT_PATH;
};

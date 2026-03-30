import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

let stepCounter = 0;

export const resetStepCounter = () => {
  stepCounter = 0;
};

export const createTraceEntry = ({ sessionId, type, name, input }) => ({
  timestamp: new Date().toISOString(),
  sessionId,
  stepId: `step-${String(++stepCounter).padStart(3, "0")}`,
  type,
  name,
  input,
  output: {},
  status: "pending",
  comment: ""
});

export const saveTrace = async (sessionId, entry) => {
  const traceDir = join(PROJECT_ROOT, "workspace/traces");
  await mkdir(traceDir, { recursive: true });

  const traceFile = join(traceDir, `${sessionId}.jsonl`);

  let existing = "";
  try {
    existing = await readFile(traceFile, "utf-8");
  } catch { /* file doesn't exist yet */ }

  const line = JSON.stringify(entry);
  await writeFile(traceFile, existing + line + "\n", "utf-8");
};

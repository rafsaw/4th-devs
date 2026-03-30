import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { task } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

export const createSession = async () => {
  const sessionId = `sendit-session-${Date.now()}`;
  const session = {
    sessionId,
    task: task.name,
    startedAt: new Date().toISOString(),
    status: "running",
    objective: `Build valid SPK declaration for free/system-funded shipment from ${task.from} to ${task.to}`,
    keyInputs: {
      senderId: task.senderId,
      from: task.from,
      to: task.to,
      weightKg: task.weightKg,
      cargo: task.cargo
    },
    importantDecisions: [],
    artifacts: {
      templatePath: null,
      knowledgePath: "workspace/notes/knowledge.json",
      draftPath: "workspace/drafts/declaration-draft.json",
      finalDeclarationPath: null
    },
    verifyAttempts: [],
    finalOutcome: null
  };

  const sessionDir = join(PROJECT_ROOT, "workspace/sessions");
  await mkdir(sessionDir, { recursive: true });
  const sessionFile = join(sessionDir, `${sessionId}.json`);
  await writeFile(sessionFile, JSON.stringify(session, null, 2), "utf-8");

  return session;
};

export const updateSession = async (sessionId, updates) => {
  const sessionFile = join(PROJECT_ROOT, "workspace/sessions", `${sessionId}.json`);
  const content = await readFile(sessionFile, "utf-8");
  const session = JSON.parse(content);

  Object.assign(session, updates);
  await writeFile(sessionFile, JSON.stringify(session, null, 2), "utf-8");

  return session;
};

export const closeSession = async (sessionId, outcome) => {
  return updateSession(sessionId, {
    status: outcome.success ? "completed" : "failed",
    finishedAt: new Date().toISOString(),
    finalOutcome: outcome
  });
};

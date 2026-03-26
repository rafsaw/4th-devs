/**
 * app.js — HTTP entry point and composition root.
 *
 * Responsibility: wire everything together and expose the single POST endpoint.
 * This is the only file that knows about Express. Everything else (LLM, tools,
 * memory) is pure logic that can be tested without starting a server.
 *
 * Endpoint:
 *   POST /api/chat
 *   Body:    { sessionID: string, msg: string }
 *   Returns: { msg: string }
 *
 * Tracing:
 *   Each request gets its own tracer instance. On completion the trace is
 *   saved to traces/<sessionID>-<timestamp>.json for post-hoc inspection.
 *   Open any trace file in VS Code / cursor to see the full agent execution.
 *
 * To expose publicly:
 *   ngrok http 3000
 *   OR configure a reverse proxy on your VPS
 */

import express from "express";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createAgent } from "./src/agent.js";
import { createTracer } from "./src/tracer.js";
import { getHistory } from "./src/memory.js";
import { model, tools, systemPrompt } from "./src/llm.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(DIR, "sessions");

const saveSession = async (sessionID) => {
  await mkdir(SESSIONS_DIR, { recursive: true });
  const history = getHistory(sessionID);
  const file = path.join(SESSIONS_DIR, `${sessionID}.json`);
  await writeFile(file, JSON.stringify(history, null, 2) + "\n", "utf-8");
};

const PORT = process.env.PORT ?? 3000;

const agent = createAgent({ model, tools, instructions: systemPrompt });

const app = express();
app.use(express.json());

app.post("/", async (req, res) => {
  const { sessionID, msg } = req.body;

  if (!sessionID || !msg) {
    return res.status(400).json({ error: "sessionID and msg are required" });
  }

  const requestStartedAt = Date.now();
  console.log(`→ [${sessionID}] ${msg}`);

  const tracer = createTracer(sessionID);
  tracer.record("http.request", { sessionID, msg });

  try {
    const reply = await agent.ask(sessionID, msg, tracer);
    const durationMs = Date.now() - requestStartedAt;

    tracer.record("http.response", { sessionID, reply, durationMs });

    await tracer.save();
    await saveSession(sessionID);

    console.log(`← [${sessionID}] ${reply} (${durationMs}ms)`);

    res.json({ msg: reply });
  } catch (err) {
    console.error(`✗ [${sessionID}] error:`, err.message);
    tracer.record("http.error", { error: err.message });
    await tracer.save().catch(() => {});
    res.status(500).json({ error: "Internal error" });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy agent listening on http://localhost:${PORT}`);
  console.log(`POST /  { sessionID, msg }`);
  console.log(`Sessions → sessions/<sessionID>.json`);
  console.log(`Traces   → traces/<sessionID>-<timestamp>.json`);
});

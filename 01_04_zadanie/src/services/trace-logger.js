/**
 * trace-logger.js — per-run event recorder, inspired by 01_03_zadanie/src/tracer.js.
 *
 * Pattern: create a tracer at startup, pass it as a dependency to every layer.
 * Each layer calls tracer.record(type, data) with domain-specific event types.
 * At the end, the entire event array is dumped as one readable JSON file.
 *
 * Event types by layer:
 *   app.*           — startup, shutdown, session lifecycle
 *   agent.*         — orchestration loop (step start, tool dispatch, final answer)
 *   llm.request     — outgoing LLM API call (model, input size, tools)
 *   llm.response    — LLM response (tokens, tool calls, text)
 *   llm.error       — LLM API failure
 *   vision.request  — outgoing vision API call
 *   vision.response — vision result
 *   tool.*          — tool execution (start, result, error)
 *   verify.*        — declaration verification attempts
 *   validation.*    — local pre-verify checks
 *
 * Usage:
 *   const tracer = createTracer(sessionId);
 *   tracer.record("agent.step.start", { step: 1, messageCount: 3 });
 *   // ... pass tracer to chat(), tools, etc.
 *   await tracer.save();
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");
const TRACES_DIR = join(PROJECT_ROOT, "workspace/traces");

const cloneJsonSafe = (value) => {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { nonSerializable: String(value) };
  }
};

export const createTracer = (sessionId = "unknown") => {
  const startedAt = new Date().toISOString();
  const events = [];
  const slug = startedAt.replace(/[:.]/g, "-");
  const outputPath = join(TRACES_DIR, `${sessionId}--${slug}.json`);

  const record = (type, data = {}) => {
    events.push({
      index: events.length + 1,
      timestamp: new Date().toISOString(),
      type,
      data: cloneJsonSafe(data),
    });
  };

  const save = async () => {
    await mkdir(TRACES_DIR, { recursive: true });
    const payload = {
      sessionId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
      eventsCount: events.length,
      eventTypes: [...new Set(events.map(e => e.type))],
      events,
    };
    await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    return outputPath;
  };

  return { record, save, path: outputPath, events };
};

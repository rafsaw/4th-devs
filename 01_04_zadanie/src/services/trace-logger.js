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
 * Tool name compaction (optional):
 *   After you know all tool names (e.g. MCP + native), call setToolNames([...]).
 *   Saved JSON includes a top-level `toolNames` catalog; per-event `tool` fields
 *   are stored as indices into that catalog (LLM traces use `toolCount` only).
 *
 * Usage:
 *   const tracer = createTracer(sessionId);
 *   tracer.setToolNames(["tool_a", "tool_b"]);
 *   tracer.record("agent.step.start", { step: 1, messageCount: 3 });
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

/**
 * Replace `tool` string fields with indices into tracer.toolNames.
 */
const encodeToolRefs = (value, indexByName) => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => encodeToolRefs(item, indexByName));
  }
  if (typeof value !== "object") return value;

  const out = { ...value };

  if (typeof out.tool === "string" && indexByName.has(out.tool)) {
    out.tool = indexByName.get(out.tool);
  }

  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v !== null && typeof v === "object") {
      out[key] = encodeToolRefs(v, indexByName);
    }
  }

  return out;
};

const buildIndexByName = (names) => new Map(names.map((n, i) => [n, i]));

export const createTracer = (sessionId = "unknown", options = {}) => {
  const startedAt = new Date().toISOString();
  const events = [];
  const slug = startedAt.replace(/[:.]/g, "-");
  const outputPath = join(TRACES_DIR, `${sessionId}--${slug}.json`);

  let toolNames = Array.isArray(options.toolNames) ? [...options.toolNames] : [];
  let indexByName = buildIndexByName(toolNames);

  const setToolNames = (names) => {
    toolNames = [...names];
    indexByName = buildIndexByName(toolNames);
  };

  const record = (type, data = {}) => {
    let payload = cloneJsonSafe(data);
    if (toolNames.length > 0) {
      payload = encodeToolRefs(payload, indexByName);
    }
    events.push({
      index: events.length + 1,
      timestamp: new Date().toISOString(),
      type,
      data: payload,
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
      ...(toolNames.length > 0 ? { toolNames } : {}),
      events,
    };
    await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    return outputPath;
  };

  return { record, save, setToolNames, path: outputPath, events };
};

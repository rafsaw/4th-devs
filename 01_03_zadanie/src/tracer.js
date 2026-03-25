/**
 * tracer.js — per-request event recorder, ported from 01_02_zadanie/src/trace.js.
 *
 * Responsibility: collect timestamped events during one HTTP request and flush
 * them to a JSON file in traces/ when the request completes. Each layer
 * (app, agent, ai, tools) receives a tracer instance and calls record(type, data).
 *
 * Usage:
 *   const tracer = createTracer(sessionID);
 *   tracer.record("llm.request", { model, inputLength });
 *   await tracer.save();  // writes traces/<sessionID>-<timestamp>.json
 *
 * Exports:
 *   createTracer(sessionID)  → { record, save, path }
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = path.resolve(MODULE_DIR, "..", "traces");

const cloneJsonSafe = (value) => {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { nonSerializable: String(value) };
  }
};

export const createTracer = (sessionID = "unknown") => {
  const startedAt = new Date().toISOString();
  const events = [];
  const slug = startedAt.replace(/[:.]/g, "-");
  const outputPath = path.join(TRACES_DIR, `${sessionID}-${slug}.json`);

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
      sessionID,
      startedAt,
      finishedAt: new Date().toISOString(),
      eventsCount: events.length,
      events,
    };
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    return outputPath;
  };

  return { record, save, path: outputPath };
};

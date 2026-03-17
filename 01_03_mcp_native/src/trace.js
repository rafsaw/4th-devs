import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TRACE_PATH = path.resolve(MODULE_DIR, "..", "trace.json");

const cloneJsonSafe = (value) => {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { nonSerializable: String(value) };
  }
};

export const createTraceRecorder = ({ outputPath = DEFAULT_TRACE_PATH } = {}) => {
  const startedAt = new Date().toISOString();
  const events = [];

  const record = (type, data = {}) => {
    events.push({
      index: events.length + 1,
      timestamp: new Date().toISOString(),
      type,
      data: cloneJsonSafe(data),
    });
  };

  const save = async () => {
    const payload = {
      startedAt,
      finishedAt: new Date().toISOString(),
      eventsCount: events.length,
      events,
    };

    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    return outputPath;
  };

  return {
    record,
    save,
    getOutputPath: () => outputPath,
  };
};

export const getDefaultTracePath = () => DEFAULT_TRACE_PATH;


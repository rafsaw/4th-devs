import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { task, verify as verifyConfig } from "../config.js";
import { postRailwayVerify } from "../helpers/railway-http.js";
import log from "../helpers/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

const LOG_DIR = join(PROJECT_ROOT, "workspace/railway-logs");
const STATE_PATH = join(PROJECT_ROOT, "workspace/notes/railway-state.json");

/** Consecutive identical payloads without obtaining a flag — stops useless loops */
let duplicateNoFlagStreak = { fingerprint: null, count: 0 };

const fingerprintAnswer = (answer) => JSON.stringify(answer ?? {});

const duplicateBlockReason = (count) =>
  `Same 'answer' JSON was used ${count} times in a row without a flag. `
  + "Do not retry this payload. Re-read help, use railway_list_recent_calls, change the next action.";

const applyDuplicateStreakAfterCall = (answer, gotFlag) => {
  const fp = fingerprintAnswer(answer);
  if (gotFlag) {
    duplicateNoFlagStreak = { fingerprint: null, count: 0 };
    return null;
  }
  if (duplicateNoFlagStreak.fingerprint === fp) {
    duplicateNoFlagStreak.count += 1;
  } else {
    duplicateNoFlagStreak = { fingerprint: fp, count: 1 };
  }
  if (duplicateNoFlagStreak.count >= 5) {
    return duplicateBlockReason(duplicateNoFlagStreak.count);
  }
  return null;
};

const ensureDir = async (dirPath) => {
  await mkdir(dirPath, { recursive: true });
};

export const nativeTools = [
  {
    type: "function",
    name: "railway_api_call",
    description:
      "POST to https://hub.ag3nts.org/verify with task 'railway'. Supply only the `answer` object (apikey/task are injected). "
      + "First call in every run must discover the API: use answer { \"action\": \"help\" }. "
      + "After help, send actions and fields exactly as the API documentation in responses describes. "
      + "Retries 503/rate limits internally — avoid spamming identical payloads when errors repeat.",
    parameters: {
      type: "object",
      properties: {
        answer: {
          type: "object",
          description: "JSON object for the verify 'answer' field, e.g. { \"action\": \"help\" } or subsequent actions from the spec.",
          additionalProperties: true,
        },
      },
      required: ["answer"],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "railway_list_recent_calls",
    description:
      "List recent persisted railway verify attempts (newest first) with summary fields for reasoning. Useful to compare errors or message wording.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max entries to return (default 8, max 25)",
        },
      },
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: "function",
    name: "railway_update_state",
    description:
      "Merge notes into workspace/notes/railway-state.json — use for stable facts learned from help (actions, parameters, ordering). Deep-merges objects; arrays are replaced.",
    parameters: {
      type: "object",
      properties: {
        updates: {
          type: "object",
          description: "Arbitrary keys to merge into railway-state.json (e.g. helpSummary, actionOrder, routeId).",
          additionalProperties: true,
        },
      },
      required: ["updates"],
      additionalProperties: false,
    },
    strict: false,
  },
];

const summarizeLogFile = async (filename) => {
  const full = join(LOG_DIR, filename);
  const raw = await readFile(full, "utf-8");
  const doc = JSON.parse(raw);
  const o = doc.outcome;
  const data = o?.data;
  const msg = typeof data?.message === "string" ? data.message : o?.rawText?.slice(0, 400);
  return {
    file: `workspace/railway-logs/${filename}`,
    timestamp: doc.timestamp,
    answer: doc.request?.answer,
    httpStatus: o?.httpStatus,
    ok: o?.ok,
    code: data?.code,
    messagePreview: typeof msg === "string" ? msg.slice(0, 350) : null,
    attempts: o?.attempts,
    rateHeaders: o?.headers ?? {},
  };
};

const nativeHandlers = {
  async railway_api_call({ answer }, tracer) {
    if (!verifyConfig.apiKey) {
      throw new Error("AG3NTS_API_KEY missing — set in root .env");
    }
    if (!answer || typeof answer !== "object") {
      throw new Error("railway_api_call requires 'answer' object");
    }

    tracer?.record("tool.railway_api_call.start", {
      answerKeys: Object.keys(answer),
    });
    log.start(`railway verify: ${JSON.stringify(answer).slice(0, 120)}...`);

    const fp = fingerprintAnswer(answer);
    if (
      duplicateNoFlagStreak.fingerprint === fp
      && duplicateNoFlagStreak.count >= 5
    ) {
      tracer?.record("tool.railway_api_call.blocked_duplicate", { answerKeys: Object.keys(answer) });
      return {
        blocked: true,
        reason: duplicateBlockReason(duplicateNoFlagStreak.count),
        hint: "Change the payload using information from help or prior responses.",
      };
    }

    const result = await postRailwayVerify({
      endpoint: verifyConfig.endpoint,
      apiKey: verifyConfig.apiKey,
      taskName: task.name,
      answer,
      tracer,
    });

    const gotFlag = Boolean(result.flagMatch);
    const streakMsg = applyDuplicateStreakAfterCall(answer, gotFlag);
    if (streakMsg) {
      tracer?.record("tool.railway_api_call.blocked_duplicate_after", {});
      return {
        blocked: true,
        reason: streakMsg,
        lastCall: {
          httpStatus: result.outcome?.httpStatus,
          logFile: result.logFile,
          data: result.outcome?.data,
          rawTextPreview: result.outcome?.rawText?.slice(0, 400),
        },
      };
    }

    log.verify(new Date().toISOString(), result.success);

    tracer?.record("tool.railway_api_call.result", {
      success: result.success,
      logFile: result.logFile,
      httpStatus: result.outcome?.httpStatus,
      hasFlag: gotFlag,
    });

    return {
      success: result.success,
      taskComplete: gotFlag,
      flag: result.flagMatch,
      httpStatus: result.outcome?.httpStatus,
      headers: result.outcome?.headers,
      data: result.outcome?.data,
      rawTextPreview: result.outcome?.rawText?.slice(0, 800) ?? "",
      attempts: result.outcome?.attempts,
      logFile: result.logFile,
      hint: gotFlag
        ? "Flag obtained — report it in your final answer and finish."
        : "Read message/code in data or rawTextPreview; follow spec for the next single best action.",
    };
  },

  async railway_list_recent_calls({ limit: limitRaw }, tracer) {
    const limit = Math.min(25, Math.max(1, Number(limitRaw) || 8));
    tracer?.record("tool.railway_list_recent_calls.start", { limit });

    await ensureDir(LOG_DIR);
    let names;
    try {
      names = await readdir(LOG_DIR);
    } catch {
      names = [];
    }
    const jsonFiles = names.filter((n) => n.endsWith(".json")).sort().reverse();
    const picked = jsonFiles.slice(0, limit);
    const items = [];
    for (const f of picked) {
      try {
        items.push(await summarizeLogFile(f));
      } catch {
        items.push({ file: f, error: "unreadable" });
      }
    }

    tracer?.record("tool.railway_list_recent_calls.result", { count: items.length });
    return { count: items.length, items };
  },

  async railway_update_state({ updates }, tracer) {
    if (!updates || typeof updates !== "object") {
      return { status: "skipped", reason: "Pass { updates: { ... } }" };
    }

    tracer?.record("tool.railway_update_state.start", { keys: Object.keys(updates) });
    await ensureDir(join(PROJECT_ROOT, "workspace/notes"));

    let state;
    try {
      state = JSON.parse(await readFile(STATE_PATH, "utf-8"));
    } catch {
      state = { fromHelp: [], notes: [], extras: {} };
    }

    for (const [key, value] of Object.entries(updates)) {
      if (
        typeof state[key] === "object"
        && state[key] !== null
        && !Array.isArray(state[key])
        && typeof value === "object"
        && value !== null
        && !Array.isArray(value)
      ) {
        state[key] = { ...state[key], ...value };
      } else {
        state[key] = value;
      }
    }

    state.lastUpdated = new Date().toISOString();
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");

    tracer?.record("tool.railway_update_state.result", { keys: Object.keys(updates) });
    return { status: "updated", state };
  },
};

export const isNativeTool = (name) => name in nativeHandlers;

export const executeNativeTool = async (name, args, tracer) => {
  const handler = nativeHandlers[name];
  if (!handler) throw new Error(`Unknown native tool: ${name}`);
  return handler(args, tracer);
};

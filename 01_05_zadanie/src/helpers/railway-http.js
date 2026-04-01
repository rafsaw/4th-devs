/**
 * Resilient POST to hub.ag3nts.org/verify for task "railway".
 * Retries 503/429/network errors with exponential backoff + jitter,
 * honors Retry-After and common rate-limit headers.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");
const LOG_DIR = join(PROJECT_ROOT, "workspace/railway-logs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jitterMs = () => Math.floor(Math.random() * 1000);

const retryAfterToMs = (response) => {
  const raw = response.headers.get("Retry-After");
  if (!raw) return null;
  const asNum = Number(raw);
  if (!Number.isNaN(asNum) && asNum >= 0) {
    return asNum * 1000;
  }
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) {
    return Math.max(0, when - Date.now());
  }
  return null;
};

const rateLimitResetToMs = (response) => {
  const reset = response.headers.get("X-RateLimit-Reset")
    ?? response.headers.get("RateLimit-Reset");
  if (!reset) return null;
  const sec = Number(reset);
  if (!Number.isNaN(sec)) {
    if (sec > 1e12) return Math.max(0, sec - Date.now());
    return Math.max(0, sec * 1000 - Date.now());
  }
  const when = Date.parse(reset);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
};

const collectInterestingHeaders = (response) => {
  const out = {};
  for (const [k, v] of response.headers) {
    const lower = k.toLowerCase();
    if (
      lower === "retry-after"
      || lower.includes("ratelimit")
      || lower.includes("rate-limit")
      || lower === "x-request-id"
    ) {
      out[k] = v;
    }
  }
  return out;
};

const isRetryableStatus = (status) => status === 503 || status === 429 || status === 502;

const parseBody = (rawText) => {
  try {
    return { json: JSON.parse(rawText), rawText };
  } catch {
    return { json: null, rawText };
  }
};

const FLAG_RE = /\{FLG:[^}]+\}/i;

/**
 * @param {object} opts
 * @param {string} opts.endpoint
 * @param {string} opts.apiKey
 * @param {string} opts.taskName
 * @param {object} opts.answer
 * @param {import("../services/trace-logger.js").createTracer} opts.tracer
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxAttempts]
 */
export const postRailwayVerify = async ({
  endpoint,
  apiKey,
  taskName,
  answer,
  tracer,
  timeoutMs = 55_000,
  maxAttempts = 10,
}) => {
  const payload = {
    apikey: apiKey,
    task: taskName,
    answer,
  };

  let attempt = 0;
  let lastOutcome = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    tracer?.record("railway.http.attempt", {
      attempt,
      maxAttempts,
      answerKeys: Object.keys(answer ?? {}),
    });

    let response;
    let rawText;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      rawText = await response.text();
    } catch (err) {
      clearTimeout(timer);
      const msg = err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message;
      tracer?.record("railway.http.error", { attempt, error: msg });

      if (attempt >= maxAttempts) {
        lastOutcome = {
          ok: false,
          httpStatus: 0,
          headers: {},
          data: null,
          rawText: "",
          error: msg,
          attempts: attempt,
        };
        break;
      }

      const backoff = Math.min(60_000, 1000 * 2 ** (attempt - 1) + jitterMs());
      tracer?.record("railway.http.backoff", { attempt, waitMs: backoff, reason: "network_or_timeout" });
      await sleep(backoff);
      continue;
    }

    clearTimeout(timer);

    const headers = collectInterestingHeaders(response);
    const parsed = parseBody(rawText);

    const outcome = {
      ok: response.ok,
      httpStatus: response.status,
      headers,
      data: parsed.json,
      rawText: parsed.rawText,
      attempts: attempt,
    };

    if (response.ok) {
      lastOutcome = outcome;
      tracer?.record("railway.http.success", {
        attempt,
        httpStatus: response.status,
        headerKeys: Object.keys(headers),
        parseError: parsed.json == null && parsed.rawText.length > 0,
      });
      break;
    }

    const fromHeader = retryAfterToMs(response) ?? rateLimitResetToMs(response);
    const shouldRetry = isRetryableStatus(response.status) || response.status === 408;

    tracer?.record("railway.http.response_error", {
      attempt,
      httpStatus: response.status,
      shouldRetry,
      headerWaitMs: fromHeader,
      bodyPreview: parsed.rawText.slice(0, 400),
    });

    if (!shouldRetry || attempt >= maxAttempts) {
      lastOutcome = outcome;
      break;
    }

    let waitMs = fromHeader;
    if (waitMs == null || waitMs < 0) {
      waitMs = Math.min(60_000, 1000 * 2 ** (attempt - 1) + jitterMs());
    } else {
      waitMs = Math.max(waitMs, 500) + jitterMs();
    }

    tracer?.record("railway.http.backoff", { attempt, waitMs, reason: `status_${response.status}` });
    await sleep(waitMs);
  }

  await mkdir(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `railway-${Date.now()}.json`);
  const logRecord = {
    timestamp: new Date().toISOString(),
    request: { task: taskName, answer },
    outcome: lastOutcome,
  };
  await writeFile(logFile, JSON.stringify(logRecord, null, 2), "utf-8");

  const relLog = `workspace/railway-logs/${logFile.split(/[\\/]/).pop()}`;

  const msg =
    (typeof lastOutcome?.data?.message === "string" ? lastOutcome.data.message : "")
    || String(lastOutcome?.rawText ?? "");
  const hasFlag = FLAG_RE.test(msg);
  const success =
    lastOutcome?.httpStatus === 200
    && (lastOutcome?.data?.code === 0 || hasFlag || /FLG:/i.test(msg));

  tracer?.record("verify.result", {
    success,
    httpStatus: lastOutcome?.httpStatus,
    code: lastOutcome?.data?.code,
    message: typeof lastOutcome?.data?.message === "string"
      ? lastOutcome.data.message.slice(0, 500)
      : lastOutcome?.rawText?.slice(0, 500),
    logFile: relLog,
    attempts: lastOutcome?.attempts,
  });

  return {
    success,
    outcome: lastOutcome,
    logFile: relLog,
    flagMatch: typeof msg === "string" ? (msg.match(FLAG_RE)?.[0] ?? null) : null,
  };
};

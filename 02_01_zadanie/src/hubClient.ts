import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AppConfig } from "./config.js";
import { parseCsvItems } from "./csv.js";
import type { CsvItem, VerifyResult } from "./types.js";

interface VerifyResponseDebug {
  output?: string;
  result?: string;
  classified_items?: number;
  required_items?: number;
  balance?: number;
}

interface VerifyResponseShape {
  code?: number;
  message?: string;
  answer?: string;
  result?: string;
  status?: string;
  debug?: VerifyResponseDebug;
}

function normalizeOutput(rawText: string): VerifyResult["normalized"] {
  const text = rawText.trim().toUpperCase().replace(/^["'<\s]+|[>"'\s.]+$/g, "");
  if (text === "DNG" || text === "NEU") {
    return text;
  }
  return "INVALID";
}

function extractFlag(rawText: string): string | undefined {
  const match = rawText.match(/\{FLG:[^}]+\}/i);
  return match?.[0];
}

export class HubClient {
  constructor(private readonly config: AppConfig) {}

  async fetchFreshCsv(): Promise<CsvItem[]> {
    const res = await this.fetchWithRetry(this.config.csvUrl, {
      method: "GET"
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to fetch CSV: HTTP ${res.status} — ${body}`);
    }
    const csvRaw = await res.text();
    await this.saveCsv(csvRaw);
    return parseCsvItems(csvRaw);
  }

  private async saveCsv(csvRaw: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = resolve(this.config.stateDir, "csv");
    const path = resolve(dir, `fetch_${timestamp}.csv`);
    const latestPath = resolve(dir, "latest.csv");
    await mkdir(dir, { recursive: true });
    await writeFile(path, csvRaw, "utf-8");
    await writeFile(latestPath, csvRaw, "utf-8");
    console.log(`   CSV saved → state/csv/latest.csv (${csvRaw.split("\n").length - 1} data rows)`);
  }

  async verifyPrompt(prompt: string): Promise<VerifyResult> {
    const body = {
      apikey: this.config.apiKey,
      task: "categorize",
      answer: { prompt }
    };

    const res = await this.fetchWithRetry(this.config.verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    const rawBody = await res.text();

    // 402 = hub-side budget exhausted; treat as a recoverable error so the caller can reset.
    if (res.status === 402) {
      return {
        rawResponse: rawBody,
        normalized: "INVALID",
        error: "Hub budget exceeded (402)"
      };
    }

    let parsed: VerifyResponseShape | undefined;
    try {
      parsed = JSON.parse(rawBody) as VerifyResponseShape;
    } catch {
      parsed = undefined;
    }

    // Hub returns classification in debug.output; fallback to other fields for older responses.
    const rawValue =
      parsed?.debug?.output ??
      parsed?.answer ??
      parsed?.result ??
      parsed?.message ??
      rawBody;

    const isError = parsed?.code !== undefined && parsed.code !== 0 && parsed.code !== 1
      ? parsed.message
      : undefined;

    return {
      rawResponse: rawBody,
      normalized: normalizeOutput(rawValue),
      flag: extractFlag(rawBody),
      error: isError
    };
  }

  async reset(): Promise<VerifyResult> {
    return this.verifyPrompt("reset");
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.config.requestRetryCount) {
      try {
        const res = await fetch(url, init);
        // 402 = hub budget exhausted — return immediately without retrying; caller handles it.
        if (res.status === 402) {
          return res;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res;
      } catch (error) {
        lastError = error;
        if (attempt === this.config.requestRetryCount) {
          break;
        }
        await sleep(this.config.requestRetryDelayMs * 2 ** attempt);
      }
      attempt += 1;
    }

    throw new Error(`Request failed after retries: ${String(lastError)}`);
  }
}

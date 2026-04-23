import { z } from "zod";
import type { Mode } from "./types.js";

const envSchema = z.object({
  API_KEY: z.string().min(1).optional(),
  AI_DEVS_4_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  ENGINEER_MODEL: z.string().default("anthropic/claude-sonnet-4-6"),
  MODE: z.enum(["SAFE_LOCAL", "REMOTE_EXPERIMENT"]).optional(),
  HUB_BASE_URL: z.string().url().default("https://hub.ag3nts.org"),
  MAX_ITERATIONS: z.coerce.number().int().min(1).default(8),
  TOKEN_LIMIT: z.coerce.number().int().min(10).default(100),
  BUDGET_LIMIT_PP: z.coerce.number().positive().default(1.5),
  REQUEST_RETRY_COUNT: z.coerce.number().int().min(0).default(3),
  REQUEST_RETRY_DELAY_MS: z.coerce.number().int().min(50).default(400),
  STATE_DIR: z.string().default("state")
});

export interface AppConfig {
  mode: Mode;
  apiKey?: string;
  openrouterApiKey?: string;
  engineerModel: string;
  hubBaseUrl: string;
  csvUrl: string;
  verifyUrl: string;
  maxIterations: number;
  tokenLimit: number;
  budgetLimitPp: number;
  requestRetryCount: number;
  requestRetryDelayMs: number;
  stateDir: string;
}

export function loadConfig(cliMode?: Mode): AppConfig {
  const parsed = envSchema.parse(process.env);
  const mode = cliMode ?? parsed.MODE ?? "SAFE_LOCAL";
  const apiKey = parsed.API_KEY ?? parsed.AI_DEVS_4_KEY;

  if (mode === "REMOTE_EXPERIMENT" && !apiKey) {
    throw new Error("API_KEY or AI_DEVS_4_KEY is required in REMOTE_EXPERIMENT mode.");
  }

  return {
    mode,
    apiKey,
    openrouterApiKey: parsed.OPENROUTER_API_KEY,
    engineerModel: parsed.ENGINEER_MODEL,
    hubBaseUrl: parsed.HUB_BASE_URL,
    csvUrl: `${parsed.HUB_BASE_URL}/data/${apiKey ?? "missing"}/categorize.csv`,
    verifyUrl: `${parsed.HUB_BASE_URL}/verify`,
    maxIterations: parsed.MAX_ITERATIONS,
    tokenLimit: parsed.TOKEN_LIMIT,
    budgetLimitPp: parsed.BUDGET_LIMIT_PP,
    requestRetryCount: parsed.REQUEST_RETRY_COUNT,
    requestRetryDelayMs: parsed.REQUEST_RETRY_DELAY_MS,
    stateDir: parsed.STATE_DIR
  };
}

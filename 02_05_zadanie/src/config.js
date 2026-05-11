import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROOT_ENV_FILE = path.join(ROOT_DIR, ".env");

const stripMatchingQuotes = (value) => {
  if (
    value.length >= 2
    && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

const loadEnvFile = (file) => {
  if (!existsSync(file)) {
    return;
  }

  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(file);
      return;
    }

    const raw = readFileSync(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const normalized = trimmed.startsWith("export ")
        ? trimmed.slice("export ".length)
        : trimmed;
      const separatorIndex = normalized.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      const key = normalized.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      const value = normalized.slice(separatorIndex + 1).trim();
      process.env[key] = stripMatchingQuotes(value);
    }
  } catch (error) {
    throw new Error(`Failed to load root .env file: ${error.message}`);
  }
};

loadEnvFile(ROOT_ENV_FILE);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() ?? "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim() ?? "";
const OPENROUTER_EXTRA_HEADERS = {
  ...(process.env.OPENROUTER_HTTP_REFERER
    ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER }
    : {}),
  ...(process.env.OPENROUTER_APP_NAME
    ? { "X-Title": process.env.OPENROUTER_APP_NAME }
    : {})
};

const AG3NTS_API_KEY = process.env.AG3NTS_API_KEY?.trim() ?? "";
const rawMapUrl = process.env.DRONE_MAP_URL?.trim() ?? "";

const asPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseModel = (value) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const separator = trimmed.indexOf(":");
  if (separator === -1) {
    return { provider: null, model: trimmed };
  }

  const provider = trimmed.slice(0, separator).trim().toLowerCase();
  const model = trimmed.slice(separator + 1).trim();

  if (!provider || !model) {
    return null;
  }

  return { provider, model };
};

const normalizeModelForProvider = (parsed, provider, fallbackModel) => {
  if (!parsed) {
    return fallbackModel;
  }

  if (parsed.provider && parsed.provider !== provider) {
    return fallbackModel;
  }

  return provider === "openrouter" && !parsed.model.includes("/")
    ? `openai/${parsed.model}`
    : parsed.model;
};

const determineModelProvider = () => {
  const forced = process.env.DRONE_AI_PROVIDER?.trim().toLowerCase();
  if (forced === "openrouter" || forced === "openai") {
    return forced;
  }

  if (OPENROUTER_API_KEY?.trim()) {
    return "openrouter";
  }

  return "openai";
};

const provider = determineModelProvider();
const defaultModel = provider === "openrouter" ? "openai/gpt-4o" : "gpt-4o";
const parsedDefaultModel = parseModel(process.env.DEFAULT_MODEL ?? "");
const parsedDroneModel = parseModel(process.env.DRONE_MODEL ?? "");

const pickModel = () => {
  if (parsedDroneModel) {
    if (parsedDroneModel.provider && parsedDroneModel.provider !== provider) {
      return defaultModel;
    }

    return provider === "openrouter" && !parsedDroneModel.model.includes("/")
      ? `openai/${parsedDroneModel.model}`
      : parsedDroneModel.model;
  }

  if (parsedDefaultModel && parsedDefaultModel.provider === provider) {
    return provider === "openrouter" && !parsedDefaultModel.model.includes("/")
      ? `openai/${parsedDefaultModel.model}`
      : parsedDefaultModel.model;
  }

  return defaultModel;
};

const resolveModelFromEnv = (envName, fallbackModel) => {
  const parsed = parseModel(process.env[envName] ?? "");
  return normalizeModelForProvider(parsed, provider, fallbackModel);
};

const buildMapUrl = () => {
  if (!rawMapUrl) {
    throw new Error(
      "Missing DRONE_MAP_URL. Set it in root .env. The URL can contain placeholder 'tutaj-twoj-klucz' or 'tutaj-twój-klucz'."
    );
  }

  if (!AG3NTS_API_KEY) {
    throw new Error("Missing AG3NTS_API_KEY in root .env");
  }

  const placeholderRegex = /tutaj-twoj-klucz|tutaj-twój-klucz|\$\{AG3NTS_API_KEY\}|\{AG3NTS_API_KEY\}/giu;
  const hasPlaceholder = placeholderRegex.test(rawMapUrl);

  if (hasPlaceholder) {
    return rawMapUrl.replace(placeholderRegex, AG3NTS_API_KEY);
  }

  if (rawMapUrl.includes("apikey=")) {
    return rawMapUrl;
  }

  const separator = rawMapUrl.includes("?") ? "&" : "?";
  return `${rawMapUrl}${separator}apikey=${encodeURIComponent(AG3NTS_API_KEY)}`;
};

const modelApiKey = provider === "openrouter"
  ? OPENROUTER_API_KEY?.trim()
  : OPENAI_API_KEY?.trim();

if (!modelApiKey) {
  throw new Error(`Missing API key for provider '${provider}'`);
}

export const config = {
  ag3ntsApiKey: AG3NTS_API_KEY,
  mapUrl: buildMapUrl(),
  droneDocsUrl: process.env.DRONE_DOCS_URL?.trim() || "https://hub.ag3nts.org/dane/drone.html",
  verifyEndpoint: process.env.DRONE_VERIFY_ENDPOINT?.trim() || "https://hub.ag3nts.org/verify",
  taskName: "drone",
  powerPlantCode: "PWR6132PL",
  provider,
  model: pickModel(),
  models: (() => {
    const baseModel = pickModel();
    const mapModel = resolveModelFromEnv("DRONE_MAP_MODEL", baseModel);
    const operatorModel = resolveModelFromEnv("DRONE_OPERATOR_MODEL", baseModel);
    const docsModel = resolveModelFromEnv("DRONE_DOCS_MODEL", operatorModel);

    return {
      map: mapModel,
      docs: docsModel,
      operator: operatorModel
    };
  })(),
  modelApiKey,
  responsesEndpoint: provider === "openrouter"
    ? "https://openrouter.ai/api/v1/responses"
    : "https://api.openai.com/v1/responses",
  extraModelHeaders: provider === "openrouter" ? OPENROUTER_EXTRA_HEADERS : {},
  mapAgent: {
    maxAttempts: asPositiveInt(process.env.DRONE_MAP_AGENT_ATTEMPTS, 3),
    maxOutputTokens: asPositiveInt(process.env.DRONE_MAP_MAX_OUTPUT_TOKENS, 300)
  },
  droneAgent: {
    maxAttempts: asPositiveInt(process.env.DRONE_AGENT_MAX_ATTEMPTS, 12),
    docsMaxAttempts: asPositiveInt(process.env.DRONE_DOCS_MAX_ATTEMPTS, 2),
    maxOutputTokens: asPositiveInt(process.env.DRONE_OPERATOR_MAX_OUTPUT_TOKENS, 700),
    docsMaxOutputTokens: asPositiveInt(process.env.DRONE_DOCS_MAX_OUTPUT_TOKENS, 900),
    reflectionMaxOutputTokens: asPositiveInt(process.env.DRONE_REFLECTION_MAX_OUTPUT_TOKENS, 450),
    resetAfterFailures: asPositiveInt(process.env.DRONE_AGENT_RESET_AFTER, 3),
    hardResetPayload: (() => {
      const raw = process.env.DRONE_HARD_RESET_PAYLOAD?.trim();
      if (!raw) {
        return "hardReset";
      }

      try {
        return JSON.parse(raw);
      } catch {
        throw new Error("DRONE_HARD_RESET_PAYLOAD must be valid JSON");
      }
    })()
  }
};

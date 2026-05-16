import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** `03_01_zadanie/` (folder z `package.json`). */
export const PACKAGE_ROOT = resolve(__dirname, "..");

/** Root repozytorium (`4th-devs`). */
export const REPO_ROOT = resolve(PACKAGE_ROOT, "..");

function parseEnvFile(filepath: string): Record<string, string> {
  if (!existsSync(filepath)) return {};
  return dotenv.parse(readFileSync(filepath));
}

/** CLI > `03_01_zadanie/.env` > repo root `.env`. */
export function resolveEnvChain(key: string): string | undefined {
  const fromCli = process.env[key]?.trim();
  if (fromCli) return fromCli;

  const local = parseEnvFile(resolve(PACKAGE_ROOT, ".env"));
  const fromLocal = local[key]?.trim();
  if (fromLocal) return fromLocal;

  const root = parseEnvFile(resolve(REPO_ROOT, ".env"));
  const fromRoot = root[key]?.trim();
  if (fromRoot) return fromRoot;

  return undefined;
}

/** No-op retained for readability at call sites (“load env”). */
export function loadEnv(): void {}

export interface AppEnv {
  sensorsZipUrl: string;
  verifyUrl: string;
  cheapModel: string;
  openrouterApiKey: string;
  ag3ntsApiKey: string;
}

export function readAppEnv(): AppEnv {
  loadEnv();

  const sensorsZipUrl = resolveEnvChain("SENSORS_ZIP_URL");
  const verifyUrl = resolveEnvChain("VERIFY_URL");
  const cheapModel = resolveEnvChain("CHEAP_MODEL");
  const openrouterApiKey = resolveEnvChain("OPENROUTER_API_KEY");
  const ag3ntsApiKey = resolveEnvChain("AG3NTS_API_KEY");

  if (!sensorsZipUrl) {
    throw new Error("SENSORS_ZIP_URL is not set (see .env.example in this folder)");
  }
  if (!verifyUrl) {
    throw new Error("VERIFY_URL is not set (see .env.example in this folder)");
  }
  if (!cheapModel) {
    throw new Error(
      "CHEAP_MODEL is not set (expected e.g. anthropic/claude-3-5-haiku — see .env.example)",
    );
  }
  if (!openrouterApiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set — add it to repo root .env (or this folder’s .env)",
    );
  }
  if (!ag3ntsApiKey) {
    throw new Error(
      "AG3NTS_API_KEY is not set — add to this folder’s .env or repo root .env",
    );
  }

  return {
    sensorsZipUrl,
    verifyUrl,
    cheapModel,
    openrouterApiKey,
    ag3ntsApiKey,
  };
}

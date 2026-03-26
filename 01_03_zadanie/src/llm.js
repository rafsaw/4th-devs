/**
 * llm.js — LLM configuration loader.
 *
 * Responsibility: single place that knows which model to use and where
 * the tool schema lives. app.js imports from here instead of reading
 * spec files directly — keeps wiring logic out of the entry point.
 *
 * Tool definitions are loaded from specs/tools.schema.json so they can
 * be edited without touching any JS code.
 *
 * Exports:
 *   model   — resolved model string (from root config.js)
 *   tools   — OpenAI-format tool definitions array
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import { resolveModelForProvider } from "../../config.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(DIR, "..", "specs", "tools.schema.json");
const SYSTEM_PATH = path.resolve(DIR, "..", "specs", "system-prompt.md");

export const model = resolveModelForProvider("openai/gpt-4.1-mini");

export const tools = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));

export const systemPrompt = await readFile(SYSTEM_PATH, "utf8");

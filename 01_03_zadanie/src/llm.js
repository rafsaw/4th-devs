/**
 * llm.js — LLM configuration and API call layer.
 *
 * Responsibility:
 *   1. Load spec files (system prompt, tool definitions) once at startup.
 *   2. Expose callLLM() — the single function that sends a request to the model.
 *
 * Everything the model needs (model id, system prompt, tools, API key, endpoint)
 * is resolved here. orchestrator.js only calls callLLM() — it does not know
 * about endpoints, keys, or response shapes.
 *
 * Exports:
 *   model        — resolved model string
 *   tools        — OpenAI-format tool definitions (from specs/tools.schema.json)
 *   systemPrompt — system instructions (from specs/system-prompt.md)
 *   callLLM({ input, tracer? })        → raw API response
 *   extractToolCalls(response)         → function_call items[]
 *   extractText(response)              → final text string | null
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import { AI_API_KEY, EXTRA_API_HEADERS, RESPONSES_API_ENDPOINT, resolveModelForProvider } from "../../config.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ── Spec files loaded once at startup ──────────────────────────────────────
export const tools = JSON.parse(
  await readFile(path.resolve(DIR, "..", "specs", "tools.schema.json"), "utf8")
);

export const systemPrompt = await readFile(
  path.resolve(DIR, "..", "specs", "system-prompt.md"), "utf8"
);

export const model = resolveModelForProvider("openai/gpt-4.1-mini");

// ── API call ────────────────────────────────────────────────────────────────

const extractResponseText = (data) => {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  const message = data?.output?.find((o) => o?.type === "message");
  const part = message?.content?.find((c) => c?.type === "output_text");
  return part?.text?.trim() ?? "";
};

/**
 * Send one request to the LLM and return the raw response object.
 * model / tools / systemPrompt are wired in from this module — caller only
 * needs to pass the conversation input array.
 *
 * @param {{ input: object[], tracer?: object }} options
 */
export const callLLM = async ({ input, tracer }) => {
  const body = {
    model,
    input,
    tools,
    tool_choice: "auto",
    instructions: systemPrompt,
  };

  tracer?.record("llm.request", {
    endpoint: RESPONSES_API_ENDPOINT,
    model,
    inputItems: input.length,
    toolNames: tools.map((t) => t.name),
    body,
  });

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    tracer?.record("llm.error", { status: response.status, error: data?.error });
    throw new Error(data?.error?.message ?? `API error (${response.status})`);
  }

  const toolCalls = (data.output ?? []).filter((o) => o.type === "function_call");
  tracer?.record("llm.response", {
    outputItems: data.output?.length ?? 0,
    hasToolCalls: toolCalls.length > 0,
    toolCallNames: toolCalls.map((c) => c.name),
    output: data.output,
  });

  return data;
};

export const extractToolCalls = (response) =>
  (response.output ?? []).filter((item) => item.type === "function_call");

export const extractText = (response) =>
  extractResponseText(response) || null;

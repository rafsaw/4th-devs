/**
 * AI provider client — HTTP calls to the OpenAI-compatible Responses API.
 *
 * Endpoint, API key, and extra headers come from the repo root config.js (env-driven),
 * so the same code can target OpenAI or OpenRouter (or similar) without branching here.
 *
 * Module overview (what this code does):
 * - chat(): builds a POST body { model, input, optional tools, tool_choice, instructions },
 *   sends JSON to RESPONSES_API_ENDPOINT with Authorization: Bearer, returns the parsed
 *   JSON payload unchanged. The agent (agent.js) interprets output (text vs function_call).
 * - extractToolCalls(): reads response.output and keeps items with type === "function_call"
 *   (model-proposed tool invocations the loop must execute).
 * - extractText() / extractResponseText: normalizes final assistant text from the Responses
 *   shape—either top-level output_text or nested output[].content output_text parts—because
 *   the API can surface text in more than one place.
 *
 * Architecture (where this sits):
 * - This layer is the LLM boundary only: it knows nothing about MCP. Tools passed into
 *   chat() are already OpenAI function-tool objects (e.g. from mcpToolsToOpenAI plus
 *   native tools). The provider runs the model; your app runs tools after inspecting
 *   function_call items.
 * - Keeps networking and response-shape quirks in one module so agent.js stays orchestration.
 *
 * Production considerations:
 * - Secrets: load keys from env or a secret manager; rotate keys and scope them minimally.
 * - Reliability: add timeouts, retries with backoff for 429/5xx where safe; handle partial
 *   failures and surface actionable errors (this file throws on !ok or data.error).
 * - Limits: respect provider rate limits and context windows; large inputs cost latency and
 *   money—trim or summarize conversation history in the agent layer if needed.
 * - Streaming: this uses a single fetch + response.json() (non-streaming). For production UX
 *   you may switch to the provider’s streaming Responses API and incremental parsing.
 * - Multi-tenant: if one backend serves many customers, isolate API keys or usage per tenant
 *   and avoid cross-tenant data leakage between sessions.
 * - Compliance: third-party inference implies data processing agreements, retention, and
 *   regional requirements—configure providers accordingly.
 */

import {
  AI_API_KEY,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT
} from "../../config.js";

// The Responses API returns text in two possible locations
const extractResponseText = (data) => {
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  const message = data?.output?.find((o) => o?.type === "message");
  const part = message?.content?.find((c) => c?.type === "output_text");
  return part?.text?.trim() ?? "";
};

/**
 * Sends a chat request to the Responses API.
 * Returns the raw response (caller extracts tool calls or text).
 */
export const chat = async ({ model, input, tools, toolChoice = "auto", instructions }) => {
  const body = { model, input };
  if (tools?.length) { body.tools = tools; body.tool_choice = toolChoice; }
  if (instructions) body.instructions = instructions;

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || `API request failed (${response.status})`);
  }

  return data;
};

export const extractToolCalls = (response) =>
  (response.output ?? []).filter((item) => item.type === "function_call");

export const extractText = (response) =>
  extractResponseText(response) || null;

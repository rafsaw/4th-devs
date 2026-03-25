/**
 * ai.js — thin wrapper around the OpenAI Responses API.
 *
 * Responsibility: send one HTTP request to the LLM, return raw response.
 * Does NOT know about sessions, tools logic, or business rules — pure I/O.
 *
 * Exports:
 *   chat({ model, input, tools, instructions, tracer? })  → raw API response object
 *   extractToolCalls(response)                            → array of function_call items
 *   extractText(response)                                 → final text string or null
 */

import { AI_API_KEY, EXTRA_API_HEADERS, RESPONSES_API_ENDPOINT } from "../../config.js";

const extractResponseText = (data) => {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  const message = data?.output?.find((o) => o?.type === "message");
  const part = message?.content?.find((c) => c?.type === "output_text");
  return part?.text?.trim() ?? "";
};

export const chat = async ({ model, input, tools, toolChoice = "auto", instructions, tracer }) => {
  const body = { model, input };
  if (tools?.length) { body.tools = tools; body.tool_choice = toolChoice; }
  if (instructions) body.instructions = instructions;

  tracer?.record("llm.request", {
    endpoint: RESPONSES_API_ENDPOINT,
    model,
    inputItems: input.length,
    toolNames: tools?.map((t) => t.name) ?? [],
    body,
  });

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

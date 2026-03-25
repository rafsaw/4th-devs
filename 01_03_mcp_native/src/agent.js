/**
 * Agent orchestration — multi-turn loop between the LLM (Responses API) and tools.
 *
 * This module is the control plane: it owns conversation state for one user query,
 * calls the model, interprets function_call items, runs the matching handlers, and
 * feeds function_call_output back until the model returns plain text or a safety
 * cap trips. It does not know whether a tool is MCP-backed or native JS; app.js
 * builds a single handler map { toolName: { execute, label } }.
 *
 * Module overview (what this code does):
 * - createAgent(config) returns { processQuery }. config carries model, OpenAI-format
 *   tools[], system instructions, and handlers map.
 * - processQuery(query): seeds conversation with one user message, then loops up to
 *   MAX_TOOL_ROUNDS. Each round: chat({ input: conversation, tools, ... }) via ai.js;
 *   extractToolCalls(response) from response.output; if none, extractText and return.
 *   If there are calls, Promise.all executes every call in parallel through
 *   executeToolCall, which JSON.parse’s arguments, looks up handlers[name], awaits
 *   execute(args), and builds { type: "function_call_output", call_id, output } strings
 *   for the API. Errors become JSON error payloads so the model can recover. The next
 *   round’s conversation is [...conversation, ...response.output, ...toolResults].
 *
 * Architecture (how it fits the stack):
 * - Sits between ai.js (HTTP to the provider) and app.js (wiring MCP + native tools into
 *   handlers). MCP client/server and OpenAI schema conversion live outside; this file
 *   only sees tool names and handler.execute.
 * - Implements the request/response pattern the Responses API expects for tool use:
 *   model emits structured function_call items; app must reply with matching call_id
 *   outputs before the next model turn.
 *
 * Production considerations:
 * - Cost and safety: MAX_TOOL_ROUNDS limits runaway tool loops and spend; tune per use
 *   case and consider per-request budgets (tokens, wall time, $).
 * - Conversation size: each round appends model output + tool outputs—context grows fast.
 *   Long sessions need trimming, summarization, or a sliding window of messages.
 * - Parallel tools: Promise.all runs all calls concurrently; good for latency when tools
 *   are independent; bad if they share locks, hit the same rate-limited API, or need
 *   ordering—then serialize, batch, or use a small concurrency pool.
 * - Errors to the model: returning raw exception messages can leak internals or confuse
 *   the model; sanitize or map to stable error codes for user-facing agents.
 * - Unknown tools: missing handlers throw before execute—ensure tool definitions and
 *   handler keys stay in sync when you add or rename tools.
 * - Authorization: this layer does not enforce who may call which tool; enforce in
 *   handlers or upstream using session/user context passed into execute if you extend it.
 * - Testing: inject a mock chat() or handlers to unit-test branching without calling the
 *   real provider.
 */

import { chat, extractToolCalls, extractText } from "./ai.js";

const MAX_TOOL_ROUNDS = 10;

const executeToolCall = async (call, handlers) => {
  const args = JSON.parse(call.arguments);
  const handler = handlers[call.name];

  if (!handler) {
    throw new Error(`Unknown tool: ${call.name}`);
  }

  try {
    const result = await handler.execute(args);
    return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) };
  } catch (error) {
    const errorPayload = { error: error.message };
    return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(errorPayload) };
  }
};

/**
 * @param {object} config
 * @param {string} config.model — model identifier
 * @param {Array} config.tools — OpenAI-format tool definitions
 * @param {string} config.instructions — system prompt
 * @param {object} config.handlers — { toolName: { execute, label } }
 */
export const createAgent = ({ model, tools, instructions, handlers }) => ({
  async processQuery(query) {
    const chatConfig = { model, tools, instructions };
    let conversation = [{ role: "user", content: query }];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await chat({ ...chatConfig, input: conversation });

      const toolCalls = extractToolCalls(response);

      if (toolCalls.length === 0) {
        return extractText(response) ?? "No response";
      }

      const toolResults = await Promise.all(
        toolCalls.map((call) => executeToolCall(call, handlers))
      );

      conversation = [...conversation, ...response.output, ...toolResults];
    }

    return "Max tool rounds reached";
  }
});

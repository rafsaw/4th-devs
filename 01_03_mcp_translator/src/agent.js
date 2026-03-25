/**
 * Agent loop — OpenAI Responses API + MCP tool execution
 *
 * What this file does
 * -------------------
 * Implements a classic **tool-calling agent**: send user text (and later model output) to the LLM with
 * MCP-derived tools, read the model’s **function_call** items, execute each call via `callMcpTool` on the
 * shared MCP client, append **function_call_output** items back into the conversation, and repeat until
 * the model returns a final answer with no more tool calls (or `MAX_STEPS` is exceeded).
 *
 * Callers pass an arbitrary `query` string — e.g. folder workflow prompts from `translator.js` or ad hoc
 * messages from `server.js` — plus `{ mcpClient, mcpTools }` from `app.js`.
 *
 * Architecture (how this fits the app)
 * ------------------------------------
 * - **LLM transport**: `chat` / `extractToolCalls` / `extractText` in `helpers/api.js` target OpenAI’s
 *   **Responses API** (`input`, `tools`, `output` items shaped for that API). This is not provider-agnostic.
 * - **Tools**: `mcpToolsToOpenAI` maps MCP `listTools` definitions into the tool schema the Responses API expects.
 * - **Execution**: `runTool` bridges OpenAI’s `function_call` shape (`name`, `arguments` JSON string, `call_id`)
 *   to MCP `callTool` and wraps results as `function_call_output` so the next `chat` round-trip is valid.
 * - **History**: `run` returns `{ response, toolCalls }` where `toolCalls` is a simplified list of
 *   `{ name, arguments }` for logging or API consumers; the full wire-format `messages` array stays internal.
 *
 * Production considerations
 * -------------------------
 * - **`MAX_STEPS`**: safety bound against runaway tool loops; raise if legitimate tasks need more rounds.
 * - **Shared `mcpClient`**: concurrent `run()` invocations (e.g. HTTP while the folder loop runs) share one
 *   MCP session; the protocol serializes requests, but overlapping long runs can still queue or contend —
 *   scale or isolate if that becomes an issue.
 * - **Errors in tools**: failures are JSON-encoded into `function_call_output` so the model can recover;
 *   they are not thrown out of `run` unless `chat` fails.
 * - **Provider lock-in**: switching to another model vendor requires new API helpers and likely different
 *   tool-result message shapes, not just swapping `mcpToolsToOpenAI`.
 */

import { chat, extractToolCalls, extractText } from "./helpers/api.js";
import { callMcpTool, mcpToolsToOpenAI } from "./mcp/client.js";
import log from "./helpers/logger.js";

/** Upper bound on model turns that include tool calls (prevents infinite loops). */
const MAX_STEPS = 80;

/**
 * Executes one OpenAI `function_call` on MCP and returns a Responses-shaped `function_call_output` item.
 */
const runTool = async (mcpClient, toolCall) => {
  const args = JSON.parse(toolCall.arguments);
  log.tool(toolCall.name, args);

  try {
    const result = await callMcpTool(mcpClient, toolCall.name, args);
    const output = JSON.stringify(result);
    log.toolResult(toolCall.name, true, output);
    return { type: "function_call_output", call_id: toolCall.call_id, output };
  } catch (error) {
    const output = JSON.stringify({ error: error.message });
    log.toolResult(toolCall.name, false, error.message);
    return { type: "function_call_output", call_id: toolCall.call_id, output };
  }
};

const runTools = (mcpClient, toolCalls) =>
  Promise.all(toolCalls.map((toolCall) => runTool(mcpClient, toolCall)));

/**
 * Runs the agent until the model stops calling tools or `MAX_STEPS` is hit.
 *
 * @param {string} query — user/task text (any caller-defined prompt)
 * @param {{ mcpClient: import("@modelcontextprotocol/sdk/client/index.js").Client, mcpTools: object[] }} ctx
 * @returns {Promise<{ response: string, toolCalls: { name: string, arguments: object }[] }>}
 */
export const run = async (query, { mcpClient, mcpTools }) => {
  const tools = mcpToolsToOpenAI(mcpTools);
  const messages = [{ role: "user", content: query }];
  const history = [];

  log.query(query);

  for (let step = 1; step <= MAX_STEPS; step++) {
    log.api(`Step ${step}`, messages.length);
    const response = await chat({ input: messages, tools });
    log.apiDone(response.usage);

    const toolCalls = extractToolCalls(response);

    if (toolCalls.length === 0) {
      const text = extractText(response) ?? "No response";
      log.response(text);
      return { response: text, toolCalls: history };
    }

    messages.push(...response.output);

    for (const tc of toolCalls) {
      history.push({ name: tc.name, arguments: JSON.parse(tc.arguments) });
    }

    const results = await runTools(mcpClient, toolCalls);
    messages.push(...results);
  }

  throw new Error(`Max steps (${MAX_STEPS}) reached`);
};

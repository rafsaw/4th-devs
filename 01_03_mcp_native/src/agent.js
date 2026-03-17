/**
 * Agent loop — processes queries using a unified set of tool handlers.
 *
 * The agent doesn't know whether a tool is served by MCP or native JS.
 * It just dispatches to the handler map built by app.js. Each handler
 * has { execute, label } so the output shows which backend ran the tool.
 */

import { chat, extractToolCalls, extractText } from "./ai.js";
import { logQuery, logToolCall, logToolResult, logToolError, logToolCount, logResponse } from "./log.js";

const MAX_TOOL_ROUNDS = 10;

const executeToolCall = async (call, handlers, tracer) => {
  const args = JSON.parse(call.arguments);
  const handler = handlers[call.name];

  if (!handler) {
    throw new Error(`Unknown tool: ${call.name}`);
  }

  logToolCall(handler.label, call.name, args);

  tracer?.record("agent.executeToolCall.start", {
    toolName: call.name,
    callId: call.call_id,
    args: JSON.stringify(args),
    handlerLabel: handler.label,
  });

  try {
    const result = await handler.execute(args);

    logToolResult(result);

    tracer?.record("agent.executeToolCall.handle.execute", {
      name: call.name,
      callId: call.call_id,
      result: JSON.stringify(result),
    });

    return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) };
  } catch (error) {
    logToolError(error.message);

    const errorPayload = { error: error.message };

    tracer?.record("agent.tool.error.to-model", {
      name: call.name,
      callId: call.call_id,
      error: errorPayload,
    });

    return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(errorPayload) };
  }
};

/**
 * @param {object} config
 * @param {string} config.model — model identifier
 * @param {Array} config.tools — OpenAI-format tool definitions
 * @param {string} config.instructions — system prompt
 * @param {object} config.handlers — { toolName: { execute, label } }
 * @param {object} [config.tracer] — trace recorder instance
 */
export const createAgent = ({ model, tools, instructions, handlers, tracer }) => ({
  async processQuery(query) {
    logQuery(query);

    const chatConfig = { model, tools, instructions };
    let conversation = [{ role: "user", content: query }];

    tracer?.record("agent.conversation.start", { conversation });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await chat({ ...chatConfig, input: conversation, tracer });

      tracer?.record("agent.model.response", { round, response });

      const toolCalls = extractToolCalls(response);

      if (toolCalls.length === 0) {
        const text = extractText(response) ?? "No response";
        logResponse(text);

        tracer?.record("agent.model.final_text", { round, text });

        return text;
      }

      logToolCount(toolCalls.length);

      tracer?.record("agent.model.tool_calls", { round, toolCalls });

      const toolResults = await Promise.all(
        toolCalls.map((call) => executeToolCall(call, handlers, tracer))
      );

      conversation = [...conversation, ...response.output, ...toolResults];
    }

    logResponse("Max tool rounds reached");
    return "Max tool rounds reached";
  }
});

/**
 * agent.js — multi-turn tool-calling loop for one conversation turn.
 *
 * Responsibility: given a sessionID + user message, run the LLM ↔ tools loop
 * until the model returns plain text (or the safety cap trips), then return
 * the final answer. Conversation history is read from and written back to
 * memory.js so each call picks up where the last left off.
 *
 * Flow per call:
 *   1. Load history from memory, append new user message.
 *   2. Send conversation to LLM (ai.js).
 *   3. If model returns tool calls → execute each (tools.js) → append results → repeat.
 *   4. If model returns text → append to history → return text.
 *
 * Tracer events emitted (all optional — tracer may be undefined):
 *   agent.turn.start        — sessionID, incoming message, history length
 *   agent.loop.round        — round number, conversation length
 *   agent.tool.call.start   — tool name, parsed args
 *   agent.tool.call.result  — tool name, result summary
 *   agent.answer            — final text returned to caller
 *
 * Exports:
 *   createAgent({ model, tools, instructions }) → { ask(sessionID, userMessage, tracer?) }
 */

import { chat, extractToolCalls, extractText } from "./ai.js";
import { getHistory, appendMessages } from "./memory.js";
import { handlers } from "./tools.js";

const MAX_TOOL_ROUNDS = 10;

const runTool = async (call, tracer) => {
  const args = JSON.parse(call.arguments);
  const fn = handlers[call.name];

  if (!fn) throw new Error(`Unknown tool: ${call.name}`);

  tracer?.record("agent.tool.call.start", { name: call.name, args });

  try {
    const result = await fn(args, tracer);
    tracer?.record("agent.tool.call.result", { name: call.name, result });
    return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) };
  } catch (err) {
    tracer?.record("agent.tool.call.error", { name: call.name, error: err.message });
    return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: err.message }) };
  }
};

export const createAgent = ({ model, tools, instructions }) => ({
  async ask(sessionID, userMessage, tracer) {
    const history = getHistory(sessionID);

    tracer?.record("agent.turn.start", {
      sessionID,
      userMessage,
      historyLength: history.length,
    });

    const userMsg = { role: "user", content: userMessage };
    appendMessages(sessionID, [userMsg]);

    let conversation = [...getHistory(sessionID)];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      tracer?.record("agent.loop.round", {
        round: round + 1,
        conversationLength: conversation.length,
      });

      const response = await chat({ model, input: conversation, tools, instructions, tracer });
      const toolCalls = extractToolCalls(response);

      if (toolCalls.length === 0) {
        const text = extractText(response) ?? "No response";
        appendMessages(sessionID, response.output ?? [{ role: "assistant", content: text }]);
        tracer?.record("agent.answer", { sessionID, text });
        return text;
      }

      const toolResults = await Promise.all(toolCalls.map((call) => runTool(call, tracer)));
      appendMessages(sessionID, [...response.output, ...toolResults]);
      conversation = getHistory(sessionID);
    }

    const fallback = "Max tool rounds reached — please try again.";
    tracer?.record("agent.max_rounds_reached", { sessionID });
    return fallback;
  }
});

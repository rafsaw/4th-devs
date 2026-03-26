/**
 * orchestrator.js — tool-calling loop for one conversation turn.
 *
 * Responsibility: given a sessionID and a user message, run the
 * LLM ↔ tools loop until the model produces a plain-text reply,
 * then return that reply. Conversation history is maintained across
 * calls via memory.js (one array per sessionID).
 *
 * Flow per call:
 *   1. Load session history, append new user message.
 *   2. Call LLM (llm.js).
 *   3. If model returns tool calls → execute each handler → append
 *      results to history → repeat from step 2.
 *   4. If model returns text → append to history → return text.
 *   5. If MAX_ITERATIONS reached → return fallback string.
 *
 * Debug points (easiest places to inspect tool-calling problems):
 *   • tracer event "llm.response"  — see what the model decided to call
 *   • tracer event "tool.call.start" — see args the model built
 *   • tracer event "tool.call.result" — see what the API returned
 *   • sessions/<sessionID>.json — full conversation history after each turn
 *
 * Exports:
 *   runOrchestrator(sessionID, userMessage, tracer?) → Promise<string>
 */

import { callLLM, extractToolCalls, extractText } from "./llm.js";
import { getHistory, appendMessages } from "./memory.js";
import { handlers } from "./tools.js";
import { applyMissionRules } from "./utils/missionRules.js";

const MAX_ITERATIONS = 5;

const FALLBACK = "Przepraszam, coś poszło nie tak. Spróbuj ponownie.";

const executeTool = async (call, tracer, history) => {
  const rawArgs = JSON.parse(call.arguments);

  // Apply deterministic mission rules before hitting the external API.
  // This is the hard backstop — independent of what the model put in the args.
  const args = applyMissionRules(call.name, rawArgs, { history, tracer });

  const fn = handlers[call.name];

  if (!fn) throw new Error(`Unknown tool: ${call.name}`);

  tracer?.record("tool.call.start", {
    name: call.name,
    argsFromModel: rawArgs,
    argsFinal: args,
    guardTriggered: args.destination !== rawArgs.destination,
  });

  try {
    const result = await fn(args, tracer);
    tracer?.record("tool.call.result", { name: call.name, result });
    return {
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(result),
    };
  } catch (err) {
    tracer?.record("tool.call.error", { name: call.name, error: err.message });
    return {
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify({ error: err.message }),
    };
  }
};

export const runOrchestrator = async (sessionID, userMessage, tracer) => {
  tracer?.record("orchestrator.start", {
    sessionID,
    userMessage,
    historyLength: getHistory(sessionID).length,
  });

  // Step 1 — add user message to session history
  appendMessages(sessionID, [{ role: "user", content: userMessage }]);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    tracer?.record("orchestrator.iteration", {
      iteration: i + 1,
      conversationLength: getHistory(sessionID).length,
    });

    // Step 2 — call the model with current history
    const response = await callLLM({ input: getHistory(sessionID), tracer });
    const toolCalls = extractToolCalls(response);

    // Step 4 — plain text reply → done
    if (toolCalls.length === 0) {
      const text = extractText(response) ?? FALLBACK;
      appendMessages(sessionID, response.output ?? [{ role: "assistant", content: text }]);
      tracer?.record("orchestrator.answer", { sessionID, text });
      return text;
    }

    // Step 3 — execute tools, append results, loop again
    const currentHistory = getHistory(sessionID);
    const toolResults = await Promise.all(
      toolCalls.map((call) => executeTool(call, tracer, currentHistory))
    );
    appendMessages(sessionID, [...response.output, ...toolResults]);
  }

  // Step 5 — safety cap
  tracer?.record("orchestrator.max_iterations", { sessionID });
  return FALLBACK;
};

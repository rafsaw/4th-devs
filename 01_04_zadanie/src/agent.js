import { chat, extractToolCalls, extractText } from "./helpers/api.js";
import { callMcpTool, mcpToolsToOpenAI } from "./mcp/client.js";
import { nativeTools, isNativeTool, executeNativeTool } from "./native/tools.js";
import log from "./helpers/logger.js";

const MAX_STEPS = 60;

const runTool = async (mcpClient, toolCall, tracer) => {
  const args = JSON.parse(toolCall.arguments);
  log.tool(toolCall.name, args);

  tracer?.record("agent.tool.dispatch", {
    tool: toolCall.name,
    argsKeys: Object.keys(args),
    callId: toolCall.call_id,
  });

  try {
    const result = isNativeTool(toolCall.name)
      ? await executeNativeTool(toolCall.name, args, tracer)
      : await callMcpTool(mcpClient, toolCall.name, args);

    const output = JSON.stringify(result);
    log.toolResult(toolCall.name, true, output);

    tracer?.record("agent.tool.result", {
      tool: toolCall.name,
      success: true,
      outputLength: output.length,
    });

    return { type: "function_call_output", call_id: toolCall.call_id, output };
  } catch (error) {
    const output = JSON.stringify({ error: error.message });
    log.toolResult(toolCall.name, false, error.message);

    tracer?.record("agent.tool.error", {
      tool: toolCall.name,
      error: error.message,
    });

    return { type: "function_call_output", call_id: toolCall.call_id, output };
  }
};

const runTools = (mcpClient, toolCalls, tracer) =>
  Promise.all(toolCalls.map(tc => runTool(mcpClient, tc, tracer)));

export const run = async (query, { mcpClient, mcpTools, tracer }) => {
  const tools = [...mcpToolsToOpenAI(mcpTools), ...nativeTools];
  const messages = [{ role: "user", content: query }];

  log.query(query);
  tracer?.record("agent.start", {
    queryLength: query.length,
    mcpToolCount: mcpTools.length,
    nativeToolCount: nativeTools.length,
    maxSteps: MAX_STEPS,
  });

  for (let step = 1; step <= MAX_STEPS; step++) {
    log.api(`Step ${step}`, messages.length);

    tracer?.record("agent.step.start", {
      step,
      messageCount: messages.length,
    });

    const response = await chat({ input: messages, tools, tracer });
    log.apiDone(response.usage);

    const toolCalls = extractToolCalls(response);

    if (toolCalls.length === 0) {
      const text = extractText(response) ?? "No response";

      tracer?.record("agent.finish", {
        step,
        totalMessages: messages.length,
        responsePreview: text.substring(0, 300),
      });

      return { response: text };
    }

    tracer?.record("agent.step.tools_requested", {
      step,
      requestedToolCount: toolCalls.length,
    });

    messages.push(...response.output);

    const results = await runTools(mcpClient, toolCalls, tracer);
    messages.push(...results);
  }

  tracer?.record("agent.max_steps_reached", { maxSteps: MAX_STEPS });
  throw new Error(`Max steps (${MAX_STEPS}) reached`);
};

import {
  AI_API_KEY,
  buildResponsesRequest,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT,
  resolveModelForProvider,
} from "../../config.js";
import { createHandlers } from "./handlers.js";
import { tools } from "./tools.js";

const MODEL = resolveModelForProvider("gpt-4.1-mini");
const MAX_TOOL_STEPS = 15;

const getToolCalls = (response) =>
  response.output?.filter((item) => item.type === "function_call") ?? [];

const getFinalText = (response) =>
  response.output_text
  ?? response.output?.find((item) => item.type === "message")?.content?.[0]?.text
  ?? "";

const requestResponse = async ({ conversation, instructions }) => {
  const body = buildResponsesRequest({
    model: MODEL,
    input: conversation,
    tools,
    instructions,
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
  if (!response.ok) {
    const message = data?.error?.message ?? `Responses API request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
};

const executeToolCall = async (toolCall, handlers) => {
  const handler = handlers[toolCall.name];
  if (!handler) {
    throw new Error(`Unknown tool call: ${toolCall.name}`);
  }

  const args = JSON.parse(toolCall.arguments || "{}");
  const result = await handler(args);

  return {
    type: "function_call_output",
    call_id: toolCall.call_id,
    output: JSON.stringify(result),
  };
};

const buildNextConversation = async (conversation, toolCalls, handlers) => {
  const outputs = [];

  for (const toolCall of toolCalls) {
    const output = await executeToolCall(toolCall, handlers);
    outputs.push(output);
  }

  return [...conversation, ...toolCalls, ...outputs];
};

const defaultInstructions = `
You are an operations analyst solving the findhim task.
Use tools instead of guessing.
Required order:
1) load_suspects
2) load_power_plants
3) for each suspect call fetch_person_context(name, surname, birthYear)
4) call build_report once all observations are collected.
When done, provide a short plain-text summary of who won and why.
`.trim();

export const createWorkflowState = () => ({
  suspects: [],
  plants: [],
  observations: [],
  report: null,
});

export const runWorkflow = async ({ apiKey, instructions = defaultInstructions } = {}) => {
  const state = createWorkflowState();
  const handlers = createHandlers({ apiKey, state });

  let conversation = [
    {
      role: "user",
      content: "Solve task findhim using tools and produce report data.",
    },
  ];

  let stepsRemaining = MAX_TOOL_STEPS;
  let finalText = "";

  while (stepsRemaining > 0) {
    stepsRemaining -= 1;
    const response = await requestResponse({ conversation, instructions });
    const toolCalls = getToolCalls(response);

    if (toolCalls.length === 0) {
      finalText = getFinalText(response);
      break;
    }

    conversation = await buildNextConversation(conversation, toolCalls, handlers);
  }

  if (!state.report) {
    throw new Error("Workflow ended without a generated report. Model did not call build_report.");
  }

  return {
    state,
    finalText,
  };
};

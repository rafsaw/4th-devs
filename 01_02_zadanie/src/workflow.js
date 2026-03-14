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
const DEBUG_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.FINDHIM_DEBUG ?? "").trim().toLowerCase(),
);

const previewText = (value, maxLength = 220) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const previewJson = (value, maxLength = 300) => {
  try {
    return previewText(JSON.stringify(value), maxLength);
  } catch {
    return previewText(String(value), maxLength);
  }
};

const debugLog = (label, payload) => {
  if (!DEBUG_ENABLED) {
    return;
  }

  if (payload === undefined) {
    console.log(`[debug] ${label}`);
    return;
  }

  console.log(`[debug] ${label}: ${previewJson(payload)}`);
};

const summarizeToolResult = (toolName, result) => {
  if (toolName === "load_suspects") {
    return { count: result?.count };
  }

  if (toolName === "load_power_plants") {
    return { count: result?.count };
  }

  if (toolName === "fetch_person_context") {
    return {
      person: `${result?.entry?.name ?? "?"} ${result?.entry?.surname ?? "?"}`.trim(),
      locationsCount: result?.entry?.locations?.length ?? 0,
      accessLevel: result?.entry?.accessLevel ?? null,
    };
  }

  if (toolName === "build_report") {
    return {
      winner: result?.winner
        ? `${result.winner.name} ${result.winner.surname}`
        : null,
      distanceKm: result?.winner?.distanceKm ?? null,
      powerPlant: result?.winner?.powerPlant ?? null,
    };
  }

  return result;
};

const readJsonResponse = async (response, contextLabel) => {
  const rawText = await response.text();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  if (!rawText.trim()) {
    throw new Error(`${contextLabel}: empty response body (status ${response.status}).`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(
      `${contextLabel}: expected JSON but got "${contentType || "unknown"}" `
      + `(status ${response.status}). Body preview: ${previewText(rawText)}`,
    );
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(
      `${contextLabel}: invalid JSON payload (status ${response.status}). `
      + `Body preview: ${previewText(rawText)}`,
    );
  }
};

const getToolCalls = (response) =>
  response.output?.filter((item) => item.type === "function_call") ?? [];

const getFinalText = (response) =>
  response.output_text
  ?? response.output?.find((item) => item.type === "message")?.content?.[0]?.text
  ?? "";

const requestResponse = async ({ conversation, instructions }) => {
  debugLog("request.model", MODEL);
  debugLog("request.conversationItems", conversation.length);

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

  const data = await readJsonResponse(response, "Responses API");
  if (!response.ok) {
    const message = data?.error?.message ?? `Responses API request failed (${response.status})`;
    throw new Error(message);
  }

  debugLog("response.outputItems", data?.output?.length ?? 0);
  return data;
};

const executeToolCall = async (toolCall, handlers, stepIndex) => {
  const handler = handlers[toolCall.name];
  if (!handler) {
    throw new Error(`Unknown tool call: ${toolCall.name}`);
  }

  const args = JSON.parse(toolCall.arguments || "{}");
  debugLog(`step.${stepIndex}.tool_call.${toolCall.name}.args`, args);
  const result = await handler(args);
  debugLog(
    `step.${stepIndex}.tool_call.${toolCall.name}.result`,
    summarizeToolResult(toolCall.name, result),
  );

  return {
    type: "function_call_output",
    call_id: toolCall.call_id,
    output: JSON.stringify(result),
  };
};

const buildNextConversation = async (conversation, toolCalls, handlers, stepIndex) => {
  const outputs = [];

  for (const toolCall of toolCalls) {
    const output = await executeToolCall(toolCall, handlers, stepIndex);
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
    const stepIndex = MAX_TOOL_STEPS - stepsRemaining + 1;
    debugLog("step.start", { stepIndex, stepsRemaining });

    stepsRemaining -= 1;
    const response = await requestResponse({ conversation, instructions });
    const toolCalls = getToolCalls(response);
    debugLog(`step.${stepIndex}.tool_calls`, toolCalls.map((call) => call.name));

    if (toolCalls.length === 0) {
      finalText = getFinalText(response);
       debugLog(`step.${stepIndex}.final_text`, finalText);
      break;
    }

    conversation = await buildNextConversation(conversation, toolCalls, handlers, stepIndex);
    debugLog(`step.${stepIndex}.conversationItemsAfter`, conversation.length);
  }

  if (!state.report) {
    throw new Error("Workflow ended without a generated report. Model did not call build_report.");
  }

  return {
    state,
    finalText,
  };
};

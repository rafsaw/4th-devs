import { api } from "../config.js";
import {
  AI_API_KEY,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT
} from "../../../config.js";
import { extractResponseText } from "./response.js";
import { recordUsage } from "./stats.js";

export const chat = async ({
  model = api.model,
  input,
  tools,
  toolChoice = "auto",
  instructions = api.instructions,
  maxOutputTokens = api.maxOutputTokens,
  tracer
}) => {
  const body = { model, input };

  if (tools?.length) body.tools = tools;
  if (tools?.length) body.tool_choice = toolChoice;
  if (instructions) body.instructions = instructions;
  if (maxOutputTokens) body.max_output_tokens = maxOutputTokens;

  tracer?.record("llm.request", {
    model,
    inputItems: input.length,
    toolNames: tools?.map(t => t.name) ?? [],
    instructionsLength: instructions?.length ?? 0,
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
    const errMsg = data?.error?.message || `Responses API request failed (${response.status})`;
    tracer?.record("llm.error", { status: response.status, error: errMsg });
    throw new Error(errMsg);
  }

  recordUsage(data.usage);

  const toolCalls = (data.output ?? []).filter(o => o.type === "function_call");
  tracer?.record("llm.response", {
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
    outputItems: data.output?.length ?? 0,
    hasToolCalls: toolCalls.length > 0,
    toolCallNames: toolCalls.map(c => c.name),
    textPreview: extractResponseText(data)?.substring(0, 200) || null,
  });

  return data;
};

export const vision = async ({ imageBase64, mimeType, question, tracer }) => {
  tracer?.record("vision.request", {
    model: api.visionModel,
    question,
    mimeType,
    imageSizeBytes: imageBase64.length,
  });

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS
    },
    body: JSON.stringify({
      model: api.visionModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: question },
            { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` }
          ]
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errMsg = data?.error?.message || `Vision request failed (${response.status})`;
    tracer?.record("vision.error", { status: response.status, error: errMsg });
    throw new Error(errMsg);
  }

  recordUsage(data.usage);
  const answer = extractResponseText(data) || "No response";

  tracer?.record("vision.response", {
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
    answerPreview: answer.substring(0, 200),
  });

  return answer;
};

export const extractToolCalls = (response) =>
  (response.output ?? []).filter((item) => item.type === "function_call");

export const extractText = (response) => {
  return extractResponseText(response) || null;
};

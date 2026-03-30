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
  maxOutputTokens = api.maxOutputTokens
}) => {
  const body = { model, input };

  if (tools?.length) body.tools = tools;
  if (tools?.length) body.tool_choice = toolChoice;
  if (instructions) body.instructions = instructions;
  if (maxOutputTokens) body.max_output_tokens = maxOutputTokens;

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
    throw new Error(data?.error?.message || `Responses API request failed (${response.status})`);
  }

  recordUsage(data.usage);
  return data;
};

export const vision = async ({ imageBase64, mimeType, question }) => {
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
    throw new Error(data?.error?.message || `Vision request failed (${response.status})`);
  }

  recordUsage(data.usage);
  return extractResponseText(data) || "No response";
};

export const extractToolCalls = (response) =>
  (response.output ?? []).filter((item) => item.type === "function_call");

export const extractText = (response) => {
  return extractResponseText(response) || null;
};

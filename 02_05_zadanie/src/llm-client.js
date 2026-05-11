import { config } from "./config.js";
import { stringifyError } from "./utils.js";

const extractResponseText = (data) => {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];

  for (const item of output) {
    if (item?.type !== "message" || !Array.isArray(item?.content)) {
      continue;
    }

    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return "";
};

export const callModel = async ({
  input,
  instructions,
  model = config.model,
  maxOutputTokens = 2000,
  temperature
}) => {
  const payload = {
    model,
    input,
    instructions,
    max_output_tokens: maxOutputTokens
  };

  if (typeof temperature === "number") {
    payload.temperature = temperature;
  }

  const response = await fetch(config.responsesEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.modelApiKey}`,
      ...config.extraModelHeaders
    },
    body: JSON.stringify(payload)
  });

  let data;
  const rawBody = await response.text();
  try {
    data = JSON.parse(rawBody);
  } catch {
    throw new Error(`Model API returned non-JSON response (${response.status}): ${rawBody.slice(0, 500)}`);
  }

  if (!response.ok || data?.error) {
    const message = data?.error?.message || rawBody.slice(0, 500) || `HTTP ${response.status}`;
    throw new Error(`Model API error: ${message}`);
  }

  return {
    text: extractResponseText(data),
    raw: data,
    requestPayload: payload
  };
};

export const printModelInfo = () => {
  console.log(
    `[llm] provider=${config.provider} mapModel=${config.models.map} docsModel=${config.models.docs} operatorModel=${config.models.operator}`
  );
};

export const safeModelCall = async (params, context) => {
  try {
    return await callModel(params);
  } catch (error) {
    throw new Error(`${context}: ${stringifyError(error)}`);
  }
};

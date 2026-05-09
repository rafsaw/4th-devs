import { config } from "./config.js";

const hasFlag = (value) => {
  if (!value) {
    return false;
  }

  const asText = typeof value === "string" ? value : JSON.stringify(value);
  return /\{FLG:[^}]+\}/i.test(asText);
};

const extractFlag = (value) => {
  if (!value) {
    return null;
  }

  const asText = typeof value === "string" ? value : JSON.stringify(value);
  const match = asText.match(/\{FLG:[^}]+\}/i);
  return match ? match[0] : null;
};

const normalizeMessage = (data, fallback) => {
  if (!data) {
    return fallback || "No response body";
  }

  if (typeof data === "string") {
    return data;
  }

  const candidates = [
    data.message,
    data.error,
    data.reason,
    data.hint,
    data.detail
  ];

  const firstText = candidates.find((item) => typeof item === "string" && item.trim());
  if (firstText) {
    return firstText;
  }

  return JSON.stringify(data);
};

export const callDroneApi = async (instructions) => {
  const normalizedInstructions = (() => {
    if (Array.isArray(instructions)) {
      return instructions;
    }

    if (instructions && typeof instructions === "object") {
      if (Array.isArray(instructions.instructions)) {
        return instructions.instructions;
      }

      return [instructions];
    }

    if (typeof instructions === "string" && instructions.trim()) {
      return [instructions.trim()];
    }

    return [];
  })();

  const payload = {
    apikey: config.ag3ntsApiKey,
    task: config.taskName,
    answer: {
      instructions: normalizedInstructions
    }
  };

  const response = await fetch(config.verifyEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();
  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    data = { message: rawText };
  }

  const successByCode = data?.code === 0;
  const successByFlag = hasFlag(data) || hasFlag(rawText);
  const success = successByCode || successByFlag;
  const flag = extractFlag(data) || extractFlag(rawText);

  return {
    ok: response.ok,
    httpStatus: response.status,
    success,
    flag,
    data,
    rawText,
    normalizedMessage: normalizeMessage(data, rawText.slice(0, 400))
  };
};

export const hardReset = async () => {
  const resetResult = await callDroneApi(config.droneAgent.hardResetPayload);
  return {
    success: resetResult.success || /reset/i.test(resetResult.normalizedMessage),
    response: resetResult
  };
};

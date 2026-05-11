const findJsonObject = (text) => {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  const direct = text.trim();
  try {
    return JSON.parse(direct);
  } catch {
    // Fall back to object extraction.
  }

  const fencedMatch = direct.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      // continue
    }
  }

  const start = direct.indexOf("{");
  const end = direct.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const candidate = direct.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

export const parseJsonObject = (text) => {
  const parsed = findJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return parsed;
};

export const parseSector = (text) => {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const column = Number.parseInt(parsed.column, 10);
  const row = Number.parseInt(parsed.row, 10);

  if (!Number.isInteger(column) || !Number.isInteger(row)) {
    return null;
  }

  if (column < 1 || row < 1) {
    return null;
  }

  return { column, row };
};

export const parseInstructionPlan = (text) => {
  const parsed = findJsonObject(text);
  if (!parsed) {
    return null;
  }

  if (Array.isArray(parsed)) {
    return { instructions: parsed };
  }

  if (Array.isArray(parsed.instructions)) {
    return { instructions: parsed.instructions };
  }

  if (parsed.answer !== undefined) {
    if (Array.isArray(parsed.answer?.instructions)) {
      return { instructions: parsed.answer.instructions };
    }

    if (Array.isArray(parsed.answer)) {
      return { instructions: parsed.answer };
    }
  }

  return null;
};

export const stringifyError = (error) => {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

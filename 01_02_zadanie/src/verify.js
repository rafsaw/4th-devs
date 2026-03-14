import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESULT_PATH = path.resolve(MODULE_DIR, "..", "wynik.md");
const VERIFY_ENDPOINT = "https://hub.ag3nts.org/verify";

const previewText = (value, maxLength = 220) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
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

const ensureObject = (value, fieldName) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
};

const ensureText = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

const ensureInteger = (value, fieldName) => {
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }

  return value;
};

export const prepareVerifyPayload = ({ apiKey, winner }) => {
  ensureText(apiKey, "apiKey");
  ensureObject(winner, "winner");

  const payload = {
    apikey: apiKey,
    task: "findhim",
    answer: {
      name: ensureText(winner.name, "winner.name"),
      surname: ensureText(winner.surname, "winner.surname"),
      accessLevel: ensureInteger(winner.accessLevel, "winner.accessLevel"),
      powerPlant: ensureText(winner.powerPlant, "winner.powerPlant"),
    },
  };

  return payload;
};

export const verifyAnswer = async (payload) => {
  const response = await fetch(VERIFY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await readJsonResponse(response, "Verify endpoint");
  if (!response.ok) {
    const message = data?.message ?? data?.error?.message ?? `Verify failed (${response.status})`;
    throw new Error(message);
  }

  return data;
};

export const saveVerifyResult = async ({ report, verifyResponse }, outputPath = RESULT_PATH) => {
  const lines = [
    "# findhim wynik",
    "",
    "## Candidate",
    `- Name: ${report.winner.name} ${report.winner.surname}`,
    `- Birth year: ${report.winner.birthYear}`,
    `- Access level: ${report.winner.accessLevel}`,
    `- Power plant: ${report.winner.powerPlant}`,
    `- Distance (km): ${report.winner.distanceKm}`,
    "",
    "## Verify response",
    "```json",
    JSON.stringify(verifyResponse, null, 2),
    "```",
    "",
  ];

  await writeFile(outputPath, `${lines.join("\n")}`, "utf-8");
  return outputPath;
};

export const getDefaultResultPath = () => RESULT_PATH;

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SUSPECTS_PATH = path.resolve(MODULE_DIR, "..", "transport_people.json");

const ensureNonEmptyText = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

const normalizeBirthYear = (value) => {
  const year = Number.parseInt(String(value), 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new Error(`Invalid birth year: ${value}`);
  }

  return year;
};

const normalizeSuspect = (candidate) => {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Suspect must be an object.");
  }

  return {
    name: ensureNonEmptyText(candidate.name, "name"),
    surname: ensureNonEmptyText(candidate.surname, "surname"),
    birthYear: normalizeBirthYear(candidate.birthYear ?? candidate.born),
  };
};

export const loadSuspectsFromFile = async (sourcePath = DEFAULT_SUSPECTS_PATH) => {
  const content = await readFile(sourcePath, "utf-8");
  const parsed = JSON.parse(content);

  if (!Array.isArray(parsed)) {
    throw new Error("Suspects file must contain an array.");
  }

  return parsed.map(normalizeSuspect);
};

export const getDefaultSuspectsPath = () => DEFAULT_SUSPECTS_PATH;

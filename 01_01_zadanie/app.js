import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  AI_API_KEY,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT,
  resolveModelForProvider
} from "../config.js";
import { extractResponseText } from "../01_01_structured/helpers.js";
// OpenRouter: dawny "arcee-ai/trinity-large-preview:free" zwraca 404 — używamy tego samego co 01_01_structured.
const MODEL = resolveModelForProvider("gpt-5.4");

const HUB_VERIFY_URL = "https://hub.ag3nts.org/verify";
const HUB_TASK_NAME = "people";
const DEFAULT_HUB_API_KEY = "4999b7d1-5386-4349-a80b-d4a2a481116f";
const HUB_API_KEY = (process.env.AI_DEVS_4_KEY ?? DEFAULT_HUB_API_KEY).trim();
const HUB_VERIFY_LOG_FILE = new URL("./hub_verify_exchange.json", import.meta.url);

// Default CSV location from the exercise description. Can be overridden with PEOPLE_CSV_PATH env.
// const DEFAULT_CSV_PATH = "Z:\\courses\\AI Devs 4\\s01e01\\people.csv";
const DEFAULT_CSV_PATH = fileURLToPath(new URL("./people.csv", import.meta.url));
const PEOPLE_CSV_PATH = process.env.PEOPLE_CSV_PATH ?? DEFAULT_CSV_PATH;

const CURRENT_YEAR = new Date().getFullYear();

const jobTaggingSchema = {
  type: "json_schema",
  name: "job_tags",
  strict: true,
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Index of the person in the input list, starting from 0."
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description:
                "List of tags describing the job. Include 'transport' for any job related to transport, logistics, driving, or moving goods/people."
            }
          },
          required: ["id", "tags"],
          additionalProperties: false
        }
      }
    },
    required: ["results"],
    additionalProperties: false
  }
};

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const record = {};

    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });

    return record;
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);

  return result.map((value) => value.trim());
}

function getField(row, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== "") {
      return String(row[key]);
    }
  }
  return "";
}

function normalizePeople(records) {
  return records
    .map((row) => {
      const firstName = getField(row, ["name", "Name", "firstName", "FirstName"]);
      const surname = getField(row, ["surname", "Surname", "lastName", "LastName"]);
      const name = [firstName, surname].filter(Boolean).join(" ");
      const genderRaw = getField(row, ["gender", "Gender", "sex", "Sex"]);
      const birthplace = getField(row, [
        "birthPlace",
        "birthplace",
        "BirthPlace",
        "Birthplace",
        "city",
        "City",
        "place_of_birth"
      ]);
      const bornRaw = getField(row, ["born", "Born", "birth_year", "BirthYear", "year", "birthDate", "BirthDate"]);
      const job = getField(row, ["job", "Job", "position", "Position", "occupation"]);

      const gender = genderRaw.trim().toUpperCase();
      const bornYear = Number.parseInt(bornRaw, 10);

      return {
        firstName: firstName.trim(),
        surname: surname.trim(),
        gender,
        city: birthplace.trim(),                            // this will be used as "city"
        born: Number.isNaN(bornYear) ? null : bornYear,     // year from birthDate
        job: job.trim()
      };
    })
    .filter((person) => person.firstName || person.surname || person.job);
}

function filterPeopleForTask(people) {
  return people.filter((person) => {
    if (person.gender !== "M") {
      return false;
    }

    if (!person.city  || person.city  !== "Grudziądz") {
      return false;
    }

    if (typeof person.born !== "number") {
      return false;
    }

    const age = CURRENT_YEAR - person.born;

    return age >= 20 && age <= 40;
  });
}

async function tagJobsBatch(people) {
  if (people.length === 0) {
    return [];
  }

  const allowedTags = [
    "IT",
    "transport",
    "edukacja",
    "medycyna",
    "praca z ludźmi",
    "praca z pojazdami",
    "praca fizyczna"
  ];

  const list = people
    .map((person, index) => `${index}: ${person.job || "no job description provided"}`)
    .join("\n");

  const prompt = [
    "You are an assistant that assigns job category tags.",
    "I will give you a numbered list of job descriptions, one per line.",
    "For each line, return an object with:",
    '- "id": the number at the start of the line (as a number),',
    '- "tags": an array of strings describing the job using only the allowed tags.',
    "",
    "Dozwolone tagi (używaj tylko z tej listy):",
    allowedTags.join(", "),
    "",
    "Zwróć tablicę obiektów z polami:",
    '- "id": numer rekordu (liczba całkowita),',
    '- "tags": tablica tagów z powyższej listy.',
    "Jeśli pasuje kilka tagów, użyj kilku.",
    "Zwróć WYŁĄCZNIE poprawny JSON, bez dodatkowego tekstu.",
    "",
    "Jobs:",
    list
  ].join("\n");

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS
    },
    body: JSON.stringify({
      model: MODEL,
      input: prompt,
      text: { format: jobTaggingSchema }
    })
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    console.error("LLM error payload:", JSON.stringify(data, null, 2));
    const message = data?.error?.message ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  const outputText = extractResponseText(data);

  if (!outputText) {
    throw new Error("Missing text output in API response");
  }

  const parsed = JSON.parse(outputText);

  if (!parsed || !Array.isArray(parsed.results)) {
    throw new Error("Expected 'results' to be an array in the model output");
  }

  return parsed.results;
}

async function submitToHub(answer) {
  const requestPayload = {
    apikey: HUB_API_KEY,
    task: HUB_TASK_NAME,
    answer
  };

  const response = await fetch(HUB_VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestPayload)
  });

  const text = await response.text();

  let responseBody;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }

  await writeFile(
    HUB_VERIFY_LOG_FILE,
    JSON.stringify(
      {
        url: HUB_VERIFY_URL,
        sentAt: new Date().toISOString(),
        request: requestPayload,
        response: {
          ok: response.ok,
          status: response.status,
          body: responseBody
        }
      },
      null,
      2
    ),
    "utf8"
  );

  if (!response.ok) {
    throw new Error(`Hub request failed with status ${response.status}: ${text}`);
  }

  if (typeof responseBody === "string") {
    console.log("Hub raw response:", responseBody);
    return;
  }

  console.log("Hub response:", responseBody);
}

async function main() {
  console.log(`Reading CSV from: ${PEOPLE_CSV_PATH}`);
  const csvRaw = await readFile(PEOPLE_CSV_PATH, "utf8");

  const records = parseCsv(csvRaw);
  console.log(`Loaded ${records.length} rows from CSV.`);

  const normalized = normalizePeople(records);
  console.log(`Normalized to ${normalized.length} people records.`);

  const filtered = filterPeopleForTask(normalized);
  console.log(`Filtered down to ${filtered.length} people matching criteria.`);

  if (filtered.length === 0) {
    console.log("No people match the filter criteria. Nothing to submit.");
    return;
  }

  console.log("Requesting job tags from the language model...");
  const taggingResults = await tagJobsBatch(filtered);

  const tagsById = new Map();
  for (const item of taggingResults) {
    if (typeof item?.id === "number" && Array.isArray(item?.tags)) {
      tagsById.set(item.id, item.tags.map((tag) => String(tag)));
    }
  }

  const withTags = filtered.map((person, index) => {
    const tags = tagsById.get(index) ?? [];

    return {
      name: person.firstName,
      surname: person.surname,
      gender: person.gender,
      born: person.born,        // year
      city: person.city,        // birthplace
      tags
    };
  });

  const withTransport = withTags.filter((person) => person.tags.includes("transport"));
  console.log(`People with 'transport' tag: ${withTransport.length}`);

  if (withTransport.length === 0) {
    console.log("No people with 'transport' tag found. Nothing to submit.");
    return;
  }

  // save to file in 01_01_zadanie/
  await writeFile(
    new URL("./transport_people.json", import.meta.url),
    JSON.stringify(withTransport, null, 2),
    "utf8"
  );

  await submitToHub(withTransport);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});


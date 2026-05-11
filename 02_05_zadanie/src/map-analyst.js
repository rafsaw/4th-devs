import { config } from "./config.js";
import { safeModelCall } from "./llm-client.js";
import { parseSector } from "./utils.js";

const MAP_ANALYST_INSTRUCTIONS = `Jestes ekspertem analizy map satelitarnych.
Twoim jedynym zadaniem jest wskazanie sektora z tama.
Mapa jest podzielona na siatke, indeksowanie od 1.
Szukaj tamy po bardziej intensywnym kolorze wody (silniejszy niebieski/turkusowy).
Zwracaj TYLKO JSON w formacie: {"column": N, "row": M}
Bez markdownu, bez dodatkowych kluczy, bez komentarza.`;

const buildPrompt = (attempt, previousOutput) => {
  if (!previousOutput) {
    return "Zlokalizuj sektor tamy na tej mapie i zwroc wynik jako JSON.";
  }

  return `Poprzednia odpowiedz nie byla poprawnym JSON sectora:
${previousOutput}

Sproboj ponownie. Wymagany format: {"column": N, "row": M}`;
};

export const runMapAnalyst = async ({ trace } = {}) => {
  let previousOutput = "";

  for (let attempt = 1; attempt <= config.mapAgent.maxAttempts; attempt += 1) {
    console.log(`[map-analyst] attempt ${attempt}/${config.mapAgent.maxAttempts}`);

    const userPrompt = buildPrompt(attempt, previousOutput);
    const result = await safeModelCall({
      instructions: MAP_ANALYST_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: userPrompt },
            { type: "input_image", image_url: config.mapUrl }
          ]
        }
      ]
    }, "Map analyst failed");

    const sector = parseSector(result.text);

    trace?.mapAnalyst.attempts.push({
      attempt,
      requestPayload: {
        ...result.requestPayload,
        input: (result.requestPayload?.input ?? []).map((msg) => ({
          ...msg,
          content: (msg.content ?? []).map((part) =>
            part.type === "input_image"
              ? { ...part, image_url: part.image_url?.replace(config.ag3ntsApiKey, "***") }
              : part
          )
        }))
      },
      responseRaw: result.raw,
      responseText: result.text,
      parsedSector: sector ?? null
    });

    if (sector) {
      console.log(`[map-analyst] resolved sector -> column=${sector.column}, row=${sector.row}`);
      return sector;
    }

    previousOutput = result.text;
  }

  throw new Error("Map analyst could not produce valid sector JSON");
};

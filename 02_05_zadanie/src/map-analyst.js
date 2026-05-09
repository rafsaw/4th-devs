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

export const runMapAnalyst = async () => {
  let previousOutput = "";

  for (let attempt = 1; attempt <= config.mapAgent.maxAttempts; attempt += 1) {
    console.log(`[map-analyst] attempt ${attempt}/${config.mapAgent.maxAttempts}`);

    const result = await safeModelCall({
      instructions: MAP_ANALYST_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildPrompt(attempt, previousOutput) },
            { type: "input_image", image_url: config.mapUrl }
          ]
        }
      ]
    }, "Map analyst failed");

    const sector = parseSector(result.text);
    if (sector) {
      console.log(`[map-analyst] resolved sector -> column=${sector.column}, row=${sector.row}`);
      return sector;
    }

    previousOutput = result.text;
  }

  throw new Error("Map analyst could not produce valid sector JSON");
};

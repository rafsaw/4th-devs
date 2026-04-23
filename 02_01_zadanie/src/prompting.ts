import type { CsvItem, PromptCandidate, PromptRender } from "./types.js";

export const promptCandidates: PromptCandidate[] = [
  {
    id: "p1_semantic",
    staticPrefix:
      "Classify cargo. Reply DNG or NEU only. NEU if reactor or fuel cassette. DNG if weapon, blade, gun, knife, crossbow, explosive, toxic, radioactive, or biohazard. Else NEU.",
    dynamicSuffixTemplate: "Item {id}: {description}",
    rationale: "Semantic weapon types + reactor NEU exception."
  },
  {
    id: "p2_weapons_focus",
    staticPrefix:
      "Output DNG or NEU only. Reactor/fuel cassette: always NEU. DNG=guns,knives,blades,crossbows,explosives,toxics,radioactive,biohazard. Else NEU.",
    dynamicSuffixTemplate: "Item {id}: {description}",
    rationale: "Compact weapon list + reactor NEU override."
  },
  {
    id: "p3_intent_based",
    staticPrefix:
      "DNG or NEU only. NEU for reactor/fuel cassette items. DNG for any weapon, cutting tool used as weapon, firearm, explosive, poison, or radioactive material. Else NEU.",
    dynamicSuffixTemplate: "Item {id}: {description}",
    rationale: "Intent-based classification with reactor exception."
  }
];

// [prompt.md] "Struktura dynamicznej instrukcji systemowej (Prompt Caching)"
// Statyczne instrukcje klasyfikatora MUSZĄ być na początku (staticPrefix),
// a zmienne dane (ID i opis z CSV) dołączane są na samym końcu jako dynamicSuffix.
// Jest to krytyczne dla utrzymania wysokiego wskaźnika cache hit po stronie huba:
// prefix jest identyczny dla wszystkich 10 itemów w iteracji → 9/10 requestów trafia w cache.
export function renderPrompt(candidate: PromptCandidate, item: CsvItem): PromptRender {
  const dynamicSuffix = candidate.dynamicSuffixTemplate.replace("{id}", item.id).replace("{description}", item.description);
  const fullPrompt = `${candidate.staticPrefix}\n${dynamicSuffix}`;
  return {
    fullPrompt,
    staticPrefix: candidate.staticPrefix,
    dynamicSuffix
  };
}

export function refineCandidate(
  previous: PromptCandidate,
  hypothesis: string,
  nextId: string
): PromptCandidate {
  const lower = hypothesis.toLowerCase();
  let staticPrefix = previous.staticPrefix;

  if (lower.includes("too long")) {
    staticPrefix = staticPrefix
      .replace("dangerous, toxic, explosive, corrosive, radioactive, flammable, weapon, biohazard, or ", "")
      .replace("Choose DNG for hazards ", "Choose DNG for ");
  }

  if (lower.includes("reactor missed")) {
    staticPrefix = `${staticPrefix} Reactor/fuel rod items: always NEU.`;
  }

  if (lower.includes("format error")) {
    staticPrefix = `Reply with one token only: DNG or NEU. ${staticPrefix}`;
  }

  return {
    id: nextId,
    staticPrefix,
    dynamicSuffixTemplate: previous.dynamicSuffixTemplate,
    rationale: `Auto-refined from ${previous.id}: ${hypothesis}`
  };
}

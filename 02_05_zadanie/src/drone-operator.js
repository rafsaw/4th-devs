import { config } from "./config.js";
import { safeModelCall } from "./llm-client.js";
import { callDroneApi, hardReset } from "./drone-api.js";
import { parseInstructionPlan, parseJsonObject } from "./utils.js";

const DOC_ANALYST_INSTRUCTIONS = `Jestes analitykiem dokumentacji API.
Masz przetworzyc dokumentacje i zwrocic tylko JSON bez markdownu:
{
  "requestContract": {
    "taskFieldValue": "...",
    "instructionsPath": "answer.instructions",
    "instructionsType": "string[]"
  },
  "supportedInstructionTemplates": ["..."],
  "missionRelevantInstructions": ["..."],
  "requiredFlightPreconditions": ["..."],
  "placeholderExamplesToAvoid": ["..."],
  "concreteExamples": ["..."],
  "recommendedMissionGoals": ["..."],
  "resetInstruction": "..."
}

W JSON umieszczaj tylko to, co wynika z dostarczonej dokumentacji.`;

const OPERATOR_INSTRUCTIONS = `To jest fikcyjne zadanie CTF w symulatorze API.
Nazwy obiektow (dron, tama, elektrownia) to etykiety techniczne scenariusza testowego.
Masz wygenerowac instrukcje dla drona wyłącznie na podstawie dokumentacji API i komunikatu bledu.
Nie zgaduj nazw komend spoza dokumentacji.
Stosuj minimalny plan misji. Nie dodawaj komend diagnostycznych/serwisowych (selfCheck, getConfig, calibrate*, hardReset) do listy instructions misji.
Traktuj flyToLocation jako trigger wykonania lotu - wszystkie ustawienia i cele ustaw przed flyToLocation.
Na podstawie feedbacku API poprawiaj tylko to, co konieczne.
Nie uzywaj placeholderow dokumentacyjnych typu set(power), set(mode), set(xm), set(x,y), setDestinationObject(ID).
Uzywaj konkretnych komend z konkretnymi wartosciami (np. set(engineON), set(100%), set(50m), set(2,4)).
Kazda odpowiedz zwracaj TYLKO jako JSON:
{"instructions":[...]}
Bez markdownu i bez dodatkowego tekstu.`;

const REFLECTION_INSTRUCTIONS = `Jestes analitykiem post-mortem dla agenta sterujacego dronem.
Dostajesz historie kilku nieudanych prob i komunikaty API.
Twoim celem jest wydedukowac najbardziej prawdopodobna przyczyne braku postepu oraz podac konkretne wskazowki zmiany kolejnej proby.
Zwracaj tylko JSON:
{
  "rootCauseHypothesis": "...",
  "adjustments": ["...", "..."],
  "nextPromptHint": "..."
}
Bez markdownu i bez dodatkowego tekstu.`;

const buildInstructionSignature = (instructions) => {
  if (!Array.isArray(instructions)) {
    return "invalid";
  }

  const tokens = instructions.map((instruction) => {
    const text = String(instruction);

    if (/^setDestinationObject\(/i.test(text)) return "dest";
    if (/^set\(\d+,\d+\)$/i.test(text)) return "sector";
    if (/^set\(\d+m\)$/i.test(text)) return "alt";
    if (/^set\(engineON\)$/i.test(text)) return "engOn";
    if (/^set\(\d+%\)$/i.test(text)) return "power";
    if (/^set\(destroy\)$/i.test(text)) return "goalDestroy";
    if (/^set\(return\)$/i.test(text)) return "goalReturn";
    if (/^set\(video\)$/i.test(text)) return "goalVideo";
    if (/^set\(image\)$/i.test(text)) return "goalImage";
    if (/^flyToLocation$/i.test(text)) return "fly";
    if (/^hardReset$/i.test(text)) return "hardReset";
    if (/^selfCheck$/i.test(text)) return "selfCheck";
    return `other:${text}`;
  });

  return tokens.join(" > ");
};

const extractSectorCoordinate = (instructions) => {
  if (!Array.isArray(instructions)) {
    return null;
  }

  for (const instruction of instructions) {
    const match = String(instruction).match(/^set\(\s*([0-9]+)\s*,\s*([0-9]+)\s*\)$/i);
    if (match) {
      return {
        column: Number.parseInt(match[1], 10),
        row: Number.parseInt(match[2], 10)
      };
    }
  }

  return null;
};

const isDamMissMessage = (message) =>
  typeof message === "string"
  && /won'?t hit the dam|drop it somewhere nearby/i.test(message);

const coordToKey = ({ column, row }) => `${column},${row}`;

const findInstructionPlanIssue = (instructions, {
  previousInstructions,
  blockedSignatures,
  blockedCoordinateKeys,
  orderingConstraint
}) => {
  if (!Array.isArray(instructions)) {
    return "instructions musi byc tablica stringow";
  }

  const placeholderPatterns = [
    /set\(power\)/i,
    /set\(mode\)/i,
    /set\(xm\)/i,
    /set\(x,y\)/i,
    /setDestinationObject\(ID\)/i
  ];

  for (const instruction of instructions) {
    if (typeof instruction !== "string") {
      return "Kazda instrukcja musi byc stringiem.";
    }

    if (placeholderPatterns.some((pattern) => pattern.test(instruction))) {
      return `Wykryto placeholder zamiast konkretu: ${instruction}`;
    }
  }

  if (Array.isArray(previousInstructions)) {
    const isDuplicate = JSON.stringify(instructions) === JSON.stringify(previousInstructions);
    if (isDuplicate) {
      return "Plan jest identyczny z poprzednia nieudana proba. Zaproponuj realna zmiane.";
    }
  }

  if (Array.isArray(blockedSignatures) && blockedSignatures.length > 0) {
    const signature = buildInstructionSignature(instructions);
    if (blockedSignatures.includes(signature)) {
      return `Plan ma taka sama strukture jak poprzednie nieudane proby (${signature}).`;
    }
  }

  const requiredPatterns = [
    { pattern: /^setDestinationObject\(.+\)$/i, label: "setDestinationObject(...)" },
    { pattern: /^set\(\d+,\d+\)$/i, label: "set(x,y)" },
    { pattern: /^set\(\d+m\)$/i, label: "set(xm)" },
    { pattern: /^set\(engineON\)$/i, label: "set(engineON)" },
    { pattern: /^set\(\d+%\)$/i, label: "set(power%)" },
    { pattern: /^set\(destroy\)$/i, label: "set(destroy)" },
    { pattern: /^set\(return\)$/i, label: "set(return)" },
    { pattern: /^flyToLocation$/i, label: "flyToLocation" }
  ];

  for (const requirement of requiredPatterns) {
    const exists = instructions.some((instruction) => requirement.pattern.test(instruction));
    if (!exists) {
      return `Brakuje wymaganej instrukcji misji: ${requirement.label}`;
    }
  }

  if (blockedCoordinateKeys instanceof Set && blockedCoordinateKeys.size > 0) {
    const coordinate = extractSectorCoordinate(instructions);
    if (coordinate) {
      const key = coordToKey(coordinate);
      if (blockedCoordinateKeys.has(key)) {
        return `Wspolrzedne ${key} sa juz zablokowane po bledzie 'nie trafisz w tame'.`;
      }
    }
  }

  const allowedPatterns = [
    /^setDestinationObject\(.+\)$/i,
    /^set\(\d+,\d+\)$/i,
    /^set\(\d+m\)$/i,
    /^set\(engineON\)$/i,
    /^set\(\d+%\)$/i,
    /^set\((destroy|return|video|image)\)$/i,
    /^flyToLocation$/i
  ];

  for (const instruction of instructions) {
    const isAllowed = allowedPatterns.some((pattern) => pattern.test(instruction));
    if (!isAllowed) {
      return `Komenda spoza minimalnego planu misji: ${instruction}`;
    }
  }

  if (orderingConstraint) {
    const flyIdx = instructions.findIndex((item) => /^flyToLocation$/i.test(String(item)));
    const returnIdx = instructions.findIndex((item) => /^set\(return\)$/i.test(String(item)));
    if (flyIdx !== -1 && returnIdx !== -1) {
      if (returnIdx > flyIdx) {
        return "Aktywna hipoteza kolejnosci: set(return) powinno byc przed flyToLocation.";
      }

      const trailingAfterFly = instructions.slice(flyIdx + 1).filter((item) => /^set\(/i.test(String(item)));
      if (trailingAfterFly.length > 0) {
        return `Aktywna hipoteza kolejnosci: po flyToLocation nie dodawaj komend set(...): ${trailingAfterFly.join(", ")}`;
      }
    }
  }

  return null;
};

const summarizeRecentAttempts = (attempts, limit = 4) => {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return "Brak historii prob.";
  }

  const recent = attempts.slice(-limit);
  return recent
    .map((entry) => (
      `#${entry.attempt} instructions=${JSON.stringify(entry.instructions)} -> apiMessage="${entry.message}"`
    ))
    .join("\n");
};

const summarizeBlockedCoordinates = (blockedCoordinates) => {
  if (!Array.isArray(blockedCoordinates) || blockedCoordinates.length === 0) {
    return "Brak zablokowanych wspolrzednych.";
  }

  return blockedCoordinates.map((item) => `${item.column},${item.row}`).join(" | ");
};

const summarizeReflectionMemory = (memory, limit = 3) => {
  if (!Array.isArray(memory) || memory.length === 0) {
    return "Brak reflection memory.";
  }

  return memory
    .slice(-limit)
    .map((entry, index) => (
      `R${index + 1}: hypothesis="${entry.rootCauseHypothesis}" adjustments=${JSON.stringify(entry.adjustments)} hint="${entry.nextPromptHint}"`
    ))
    .join("\n");
};

const buildStructureConstraint = (attempts, feedback) => {
  if (!Array.isArray(attempts) || attempts.length < 2 || !feedback) {
    return null;
  }

  const matchingAttempts = attempts.filter((entry) => entry.message === feedback);
  if (matchingAttempts.length < 2) {
    return null;
  }

  const blockedSignatures = [...new Set(matchingAttempts.map((entry) => entry.signature).filter(Boolean))];
  if (blockedSignatures.length === 0) {
    return null;
  }

  return {
    reason: `Powtarzajacy sie blad API "${feedback}" dla ${matchingAttempts.length} prob`,
    blockedSignatures
  };
};

const detectReflectionTrigger = (attempts) => {
  if (!Array.isArray(attempts) || attempts.length < 2) {
    return null;
  }

  const last = attempts[attempts.length - 1];
  const prev = attempts[attempts.length - 2];

  const sameMessage = last.message === prev.message;
  const sameInstructions = JSON.stringify(last.instructions) === JSON.stringify(prev.instructions);

  if (sameMessage || sameInstructions) {
    return {
      signature: `${sameMessage ? last.message : "msg-diff"}::${sameInstructions ? "same-plan" : "plan-diff"}`,
      reason: sameMessage
        ? `Powtarzajacy sie blad API: ${last.message}`
        : "Powtorzono identyczny plan instrukcji"
    };
  }

  return null;
};

const detectOrderingConstraint = (attempts) => {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return null;
  }

  const last = attempts[attempts.length - 1];
  if (!/without a return instruction/i.test(last.message)) {
    return null;
  }

  const instructions = Array.isArray(last.instructions) ? last.instructions : [];
  const flyIdx = instructions.findIndex((item) => /^flyToLocation$/i.test(String(item)));
  const returnIdx = instructions.findIndex((item) => /^set\(return\)$/i.test(String(item)));

  if (flyIdx === -1 || returnIdx === -1) {
    return null;
  }

  if (returnIdx > flyIdx) {
    return {
      reason: "API nadal raportuje brak return mimo obecnosci set(return) po flyToLocation.",
      rule: "set(return) musi byc przed flyToLocation, a po flyToLocation nie dodawaj juz komend set(...)."
    };
  }

  return null;
};

const runSelfReflection = async ({ apiKnowledge, attempts, sector, feedback }) => {
  const prompt = [
    "API knowledge (JSON):",
    JSON.stringify(apiKnowledge),
    "",
    `Sektor tamy: column=${sector.column}, row=${sector.row}`,
    `Ostatni blad API: ${feedback}`,
    "",
    "Historia prob:",
    summarizeRecentAttempts(attempts, 6),
    "",
    "Przeanalizuj przyczyne braku postepu i podaj wskazowki kolejnej proby."
  ].join("\n");

  const result = await safeModelCall({
    model: config.models.operator,
    maxOutputTokens: config.droneAgent.reflectionMaxOutputTokens,
    instructions: REFLECTION_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt }
        ]
      }
    ]
  }, "Drone reflection failed");

  const parsed = parseJsonObject(result.text);
  const rootCauseHypothesis = typeof parsed?.rootCauseHypothesis === "string"
    ? parsed.rootCauseHypothesis
    : result.text;
  const adjustments = Array.isArray(parsed?.adjustments)
    ? parsed.adjustments.filter((item) => typeof item === "string")
    : [];
  const nextPromptHint = typeof parsed?.nextPromptHint === "string"
    ? parsed.nextPromptHint
    : "";

  const adviceText = [
    rootCauseHypothesis ? `Hipoteza: ${rootCauseHypothesis}` : "",
    adjustments.length > 0 ? `Zmiany: ${adjustments.join(" | ")}` : "",
    nextPromptHint ? `Hint: ${nextPromptHint}` : ""
  ].filter(Boolean).join(" || ");

  return {
    rawText: result.text,
    requestPayload: result.requestPayload,
    responseRaw: result.raw,
    reflection: {
      rootCauseHypothesis,
      adjustments,
      nextPromptHint,
      adviceText
    }
  };
};

const normalizeInstructionSyntax = (instructions) => {
  if (!Array.isArray(instructions)) {
    return [];
  }

  const normalized = instructions.map((instruction) => {
    const raw = String(instruction ?? "").trim();
    if (!raw) {
      return raw;
    }

    const setModeMatch = raw.match(/^set\(mode\)\s*([a-zA-Z_%-]+)$/i) || raw.match(/^setMode\(([^)]+)\)$/i);
    if (setModeMatch) {
      const modeRaw = setModeMatch[1].trim();
      const mode = modeRaw.toLowerCase();
      if (mode === "return_to_base" || mode === "return-to-base" || mode === "returntobase") {
        return "set(return)";
      }
      if (mode === "engineon") return "set(engineON)";
      if (mode === "engineoff") return "set(engineOFF)";
      if (mode === "return" || mode === "destroy" || mode === "video" || mode === "image") {
        return `set(${mode})`;
      }
      return `set(${modeRaw})`;
    }

    const powerMatch =
      raw.match(/^set\(power\)\s*([0-9]{1,3})%?$/i)
      || raw.match(/^set\(power,\s*([0-9]{1,3})%?\)$/i)
      || raw.match(/^set\(power\)([0-9]{1,3})%?$/i)
      || raw.match(/^set\(power\s+([0-9]{1,3})%?\)$/i)
      || raw.match(/^set\(power([0-9]{1,3})%?\)$/i);
    if (powerMatch) {
      const value = Number.parseInt(powerMatch[1], 10);
      if (Number.isInteger(value)) {
        const clamped = Math.max(0, Math.min(100, value));
        return `set(${clamped}%)`;
      }
    }

    const altitudeMatch =
      raw.match(/^set\(xm,\s*([0-9]{1,3})m?\)$/i)
      || raw.match(/^set\(xm\)\s*([0-9]{1,3})m?$/i)
      || raw.match(/^set\(xm\s+([0-9]{1,3})m?\)$/i)
      || raw.match(/^set\(xm([0-9]{1,3})m?\)$/i)
      || raw.match(/^setAltitude\(([^)]+)\)$/i);
    if (altitudeMatch) {
      const value = Number.parseInt(altitudeMatch[1], 10);
      if (Number.isInteger(value)) {
        const clamped = Math.max(1, Math.min(100, value));
        return `set(${clamped}m)`;
      }
    }

    return raw;
  });

  let xValue = null;
  let yValue = null;
  let xIndex = -1;
  let yIndex = -1;

  normalized.forEach((instruction, index) => {
    const xMatch = instruction.match(/^set\(x,\s*([0-9]+)\)$/i);
    const yMatch = instruction.match(/^set\(y,\s*([0-9]+)\)$/i);
    if (xMatch) {
      xValue = Number.parseInt(xMatch[1], 10);
      xIndex = index;
    }
    if (yMatch) {
      yValue = Number.parseInt(yMatch[1], 10);
      yIndex = index;
    }
  });

  const hasSector = normalized.some((instruction) => /^set\([0-9]+,\s*[0-9]+\)$/i.test(instruction));
  if (!hasSector && Number.isInteger(xValue) && Number.isInteger(yValue) && xIndex !== -1 && yIndex !== -1) {
    const firstIndex = Math.min(xIndex, yIndex);
    const secondIndex = Math.max(xIndex, yIndex);
    normalized[firstIndex] = `set(${xValue},${yValue})`;
    normalized[secondIndex] = "";
  }

  return normalized.filter((instruction) => instruction && instruction.trim());
};

const normalizeDocumentation = (text) =>
  text
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();

const fetchDroneDocumentation = async () => {
  const response = await fetch(config.droneDocsUrl);
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Cannot fetch drone documentation (${response.status}): ${rawText.slice(0, 300)}`);
  }

  return normalizeDocumentation(rawText);
};

const analyzeDroneDocumentation = async ({ docsText, trace }) => {
  let previousOutput = "";

  for (let attempt = 1; attempt <= config.droneAgent.docsMaxAttempts; attempt += 1) {
    const prompt = previousOutput
      ? `Poprzedni JSON byl niepoprawny:
${previousOutput}

Sprobuj ponownie i zwroc poprawny JSON zgodny ze schematem.`
      : "Przeanalizuj dokumentacje i zwroc JSON zgodny ze schematem.";

    const result = await safeModelCall({
      model: config.models.docs,
      maxOutputTokens: config.droneAgent.docsMaxOutputTokens,
      instructions: DOC_ANALYST_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: `${prompt}\n\nDOKUMENTACJA:\n${docsText}` }
          ]
        }
      ]
    }, "Drone docs analyst failed");

    const parsed = parseJsonObject(result.text);
    const valid = parsed
      && parsed.requestContract
      && typeof parsed.requestContract.instructionsPath === "string"
      && Array.isArray(parsed.supportedInstructionTemplates)
      && Array.isArray(parsed.missionRelevantInstructions);

    trace?.droneOperator.docsAnalysisAttempts.push({
      attempt,
      requestPayload: result.requestPayload,
      responseRaw: result.raw,
      responseText: result.text,
      parsedKnowledge: valid ? parsed : null
    });

    if (valid) {
      return parsed;
    }

    previousOutput = result.text;
  }

  throw new Error("Could not extract valid API knowledge from drone documentation");
};

const buildIterationPrompt = ({
  sector,
  attempt,
  feedback,
  previousInstructions,
  apiKnowledge,
  attempts,
  reflectionAdvice,
  reflectionMemory,
  structureConstraint,
  blockedCoordinates,
  orderingConstraint
}) => {
  const parts = [
    "API knowledge (JSON from docs analysis):",
    JSON.stringify(apiKnowledge),
    "",
    `Sektor tamy: column=${sector.column}, row=${sector.row}.`,
    `Oficjalny cel lotu: ${config.powerPlantCode}.`,
    `To jest proba ${attempt}.`,
    "",
    "Historia ostatnich prob:",
    summarizeRecentAttempts(attempts),
    "",
    "Reflection memory:",
    summarizeReflectionMemory(reflectionMemory),
    "",
    "Wspolrzedne juz sprawdzone przy bledzie 'nie trafisz w tame':",
    summarizeBlockedCoordinates(blockedCoordinates)
  ];

  if (previousInstructions) {
    parts.push(`Poprzednie instructions: ${JSON.stringify(previousInstructions)}`);
  }

  if (feedback) {
    parts.push(`Blad API do poprawy: ${feedback}`);
  } else {
    parts.push("Zacznij od najprostszej mozliwej sekwencji instrukcji.");
  }

  if (reflectionAdvice) {
    parts.push(`Self-reflection advice: ${reflectionAdvice}`);
  }

  if (structureConstraint) {
    parts.push(`Aktywny constraint struktury: ${structureConstraint.reason}`);
    parts.push(`Zakazane sygnatury: ${JSON.stringify(structureConstraint.blockedSignatures)}`);
    parts.push("Nowa propozycja musi miec inna strukture niz zakazane sygnatury.");
  }

  if (orderingConstraint) {
    parts.push(`Aktywna hipoteza kolejnosci: ${orderingConstraint.reason}`);
    parts.push(`Regula robocza: ${orderingConstraint.rule}`);
  }

  parts.push("Plan musi zawierac minimum: setDestinationObject(...), set(x,y), set(xm), set(engineON), set(power%), flyToLocation.");
  parts.push("Cele misji (set(destroy), set(return), set(video), set(image)) dobieraj na podstawie dokumentacji i feedbacku API.");
  parts.push("Nie uzywaj komend diagnostycznych/serwisowych w planie misji (selfCheck, getConfig, getFirmwareVersion, calibrate*, hardReset).");
  parts.push("Jesli API zwraca ze nie trafisz w tame, zmien wspolrzedne set(x,y), ale trzymaj sie komend z dokumentacji.");
  parts.push("Jesli wystepuje blad 'nie trafisz w tame', kolejna proba MUSI miec nowe set(x,y), inne niz zablokowane wspolrzedne.");
  parts.push("Jesli API twierdzi, ze brakuje precondition mimo obecnosci danej komendy, potraktuj to jako problem kolejnosci/stanu i zmien uklad instrukcji.");
  parts.push("Nie powtarzaj identycznej listy instructions po nieudanej probie.");
  parts.push("Odpowiedz wylacznie JSON-em: {\"instructions\":[...]}.");

  return parts.join("\n");
};

const askOperatorForInstructions = async ({
  sector,
  attempt,
  feedback,
  previousInstructions,
  apiKnowledge,
  attempts,
  reflectionAdvice,
  reflectionMemory,
  structureConstraint,
  blockedCoordinates,
  orderingConstraint
}) => {
  const userPrompt = buildIterationPrompt({
    sector,
    attempt,
    feedback,
    previousInstructions,
    apiKnowledge,
    attempts,
    reflectionAdvice,
    reflectionMemory,
    structureConstraint,
    blockedCoordinates,
    orderingConstraint
  });

  const result = await safeModelCall({
    model: config.models.operator,
    maxOutputTokens: config.droneAgent.maxOutputTokens,
    instructions: OPERATOR_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: userPrompt }
        ]
      }
    ]
  }, "Drone operator failed");

  const parsed = parseInstructionPlan(result.text);
  if (!parsed) {
    throw new Error(`Drone operator returned invalid JSON plan: ${result.text}`);
  }

  return {
    instructions: parsed.instructions,
    userPrompt,
    rawText: result.text,
    requestPayload: result.requestPayload,
    responseRaw: result.raw
  };
};

export const runDroneOperator = async ({ sector, trace }) => {
  let consecutiveFailures = 0;
  let feedback = "";
  let previousInstructions = null;
  const attempts = [];
  let apiKnowledge = null;
  let reflectionAdvice = "";
  let lastReflectionSignature = null;
  const reflectionMemory = [];
  let structureConstraint = null;
  const blockedCoordinateKeys = new Set();
  let orderingConstraint = null;

  if (trace?.droneOperator) {
    trace.droneOperator.systemInstructions = OPERATOR_INSTRUCTIONS;
    trace.droneOperator.docsAnalystInstructions = DOC_ANALYST_INSTRUCTIONS;
    trace.droneOperator.howInstructionsAreChosen =
      "Najpierw agent pobiera drone.html i prosi LLM o ekstrakcje kontraktu API (JSON). Potem kazda proba planu instructions jest generowana przez LLM na podstawie: sektora tamy, extracted API knowledge, poprzednich instructions i bledu z /verify. Przy powtarzajacych sie porazkach uruchamia osobny krok self-reflection i dodaje jego wnioski do kolejnego promptu operatora.";
  }

  const docsText = await fetchDroneDocumentation();
  if (trace?.droneOperator) {
    trace.droneOperator.documentation = {
      sourceUrl: config.droneDocsUrl,
      length: docsText.length,
      preview: docsText.slice(0, 1000)
    };
  }

  apiKnowledge = await analyzeDroneDocumentation({ docsText, trace });
  if (trace?.droneOperator) {
    trace.droneOperator.apiKnowledge = apiKnowledge;
  }

  for (let attempt = 1; attempt <= config.droneAgent.maxAttempts; attempt += 1) {
    console.log(`[drone-operator] attempt ${attempt}/${config.droneAgent.maxAttempts}`);

    let operatorResult = null;
    let instructions = null;
    let llmRequest = null;
    let llmResponse = null;
    let llmUserPrompt = null;
    let llmResponseText = null;
    let localValidationIssue = null;
    let attemptFeedback = feedback;

    for (let planAttempt = 1; planAttempt <= 3; planAttempt += 1) {
      operatorResult = await askOperatorForInstructions({
        sector,
        attempt,
        feedback: attemptFeedback,
        previousInstructions,
        apiKnowledge,
        attempts,
        reflectionAdvice,
        reflectionMemory,
        structureConstraint,
        blockedCoordinates: [...blockedCoordinateKeys].map((key) => {
          const [column, row] = key.split(",").map((value) => Number.parseInt(value, 10));
          return { column, row };
        }),
        orderingConstraint
      });

      const rawInstructions = Array.isArray(operatorResult.instructions)
        ? operatorResult.instructions
        : [];
      instructions = normalizeInstructionSyntax(rawInstructions);
      llmRequest = operatorResult.requestPayload;
      llmResponse = operatorResult.responseRaw;
      llmUserPrompt = operatorResult.userPrompt;
      llmResponseText = operatorResult.rawText;

      localValidationIssue = findInstructionPlanIssue(instructions, {
        previousInstructions,
        blockedSignatures: structureConstraint?.blockedSignatures ?? [],
        blockedCoordinateKeys,
        orderingConstraint
      });
      if (!localValidationIssue) {
        break;
      }

      attemptFeedback = `Lokalna walidacja planu: ${localValidationIssue}. Popraw plan i podaj tylko konkretne wartosci.`;
      previousInstructions = instructions;
      console.log(`[drone-operator] local validation feedback: ${localValidationIssue}`);
    }

    if (localValidationIssue) {
      const signature = buildInstructionSignature(instructions);
      const validationMessage = `Lokalna walidacja odrzucila plan: ${localValidationIssue}`;

      attempts.push({
        attempt,
        instructions,
        signature,
        httpStatus: 0,
        success: false,
        message: validationMessage
      });

      trace?.droneOperator.iterations.push({
        attempt,
        llmInvolved: true,
        userPrompt: llmUserPrompt,
        llmResponseText,
        llmRequest,
        llmResponse,
        rawModelInstructions: operatorResult?.instructions ?? null,
        parsedInstructions: instructions,
        signature,
        localValidationIssue,
        activeStructureConstraint: structureConstraint,
        activeOrderingConstraint: orderingConstraint,
        blockedCoordinates: [...blockedCoordinateKeys],
        droneApi: {
          httpStatus: 0,
          success: false,
          flag: null,
          message: validationMessage
        },
        hardResetTriggered: false
      });

      consecutiveFailures += 1;
      feedback = validationMessage;
      previousInstructions = instructions;
      structureConstraint = buildStructureConstraint(attempts, feedback);

      console.log(`[drone-operator] ${validationMessage}`);

      if (consecutiveFailures > config.droneAgent.resetAfterFailures) {
        console.log("[drone-operator] triggering hardReset");
        const resetResult = await hardReset();
        consecutiveFailures = 0;
        feedback = `Po hardReset API odpowiedzialo: ${resetResult.response.normalizedMessage}. Zaproponuj plan od zera na podstawie dokumentacji.`;
        previousInstructions = null;
        reflectionAdvice = "";
        lastReflectionSignature = null;
        structureConstraint = null;
        blockedCoordinateKeys.clear();
        orderingConstraint = null;

        if (trace?.droneOperator.iterations.length > 0) {
          const latest = trace.droneOperator.iterations[trace.droneOperator.iterations.length - 1];
          latest.hardResetTriggered = true;
          latest.hardResetResponse = {
            httpStatus: resetResult.response.httpStatus,
            message: resetResult.response.normalizedMessage
          };
        }
      }

      continue;
    }

    const verifyResult = await callDroneApi(instructions);
    const currentCoordinate = extractSectorCoordinate(instructions);

    attempts.push({
      attempt,
      instructions,
      signature: buildInstructionSignature(instructions),
      httpStatus: verifyResult.httpStatus,
      success: verifyResult.success,
      message: verifyResult.normalizedMessage
    });

    trace?.droneOperator.iterations.push({
      attempt,
      llmInvolved: true,
      userPrompt: llmUserPrompt,
      llmResponseText,
      llmRequest,
      llmResponse,
      rawModelInstructions: operatorResult?.instructions ?? null,
      parsedInstructions: instructions,
      signature: buildInstructionSignature(instructions),
      localValidationIssue,
      activeStructureConstraint: structureConstraint,
      activeOrderingConstraint: orderingConstraint,
      blockedCoordinates: [...blockedCoordinateKeys],
      droneApi: {
        httpStatus: verifyResult.httpStatus,
        success: verifyResult.success,
        flag: verifyResult.flag ?? null,
        message: verifyResult.normalizedMessage
      },
      hardResetTriggered: false
    });

    if (currentCoordinate && isDamMissMessage(verifyResult.normalizedMessage)) {
      blockedCoordinateKeys.add(coordToKey(currentCoordinate));
    }

    if (verifyResult.success && verifyResult.flag) {
      if (trace?.droneOperator) {
        const llmCalls = trace.droneOperator.iterations.length;
        trace.droneOperator.planningNotes = {
          llmCallsForInstructionPlan: llmCalls,
          resolvedBy: "docs_driven_main_loop",
          detail: "Lista instructions byla generowana przez LLM na podstawie wiedzy wyekstrahowanej z drone.html oraz feedbacku API."
        };
      }
      return {
        flag: verifyResult.flag,
        finalResponse: verifyResult.data,
        attempts
      };
    }

    consecutiveFailures += 1;
    feedback = verifyResult.normalizedMessage;
    previousInstructions = instructions;

    console.log(`[drone-operator] api feedback: ${feedback}`);

    structureConstraint = buildStructureConstraint(attempts, feedback);
    const maybeOrderingConstraint = detectOrderingConstraint(attempts);
    if (maybeOrderingConstraint) {
      orderingConstraint = maybeOrderingConstraint;
    }

    const reflectionTrigger = detectReflectionTrigger(attempts);
    if (reflectionTrigger && reflectionTrigger.signature !== lastReflectionSignature) {
      const reflectionResult = await runSelfReflection({
        apiKnowledge,
        attempts,
        sector,
        feedback
      });

      reflectionAdvice = reflectionResult.reflection.adviceText;
      lastReflectionSignature = reflectionTrigger.signature;
      reflectionMemory.push({
        attempt,
        rootCauseHypothesis: reflectionResult.reflection.rootCauseHypothesis,
        adjustments: reflectionResult.reflection.adjustments,
        nextPromptHint: reflectionResult.reflection.nextPromptHint
      });

      trace?.droneOperator.reflections.push({
        attempt,
        trigger: reflectionTrigger,
        requestPayload: reflectionResult.requestPayload,
        responseRaw: reflectionResult.responseRaw,
        responseText: reflectionResult.rawText,
        reflection: reflectionResult.reflection
      });

      if (reflectionAdvice) {
        feedback = `${feedback}\n${reflectionAdvice}`;
        console.log("[drone-operator] self-reflection advice added");
      }
    }

    if (consecutiveFailures > config.droneAgent.resetAfterFailures) {
      console.log("[drone-operator] triggering hardReset");
      const resetResult = await hardReset();
      consecutiveFailures = 0;
      feedback = `Po hardReset API odpowiedzialo: ${resetResult.response.normalizedMessage}. Zaproponuj plan od zera na podstawie dokumentacji.`;
      previousInstructions = null;
      reflectionAdvice = "";
      lastReflectionSignature = null;
      structureConstraint = null;
      blockedCoordinateKeys.clear();
      orderingConstraint = null;

      if (trace?.droneOperator.iterations.length > 0) {
        const latest = trace.droneOperator.iterations[trace.droneOperator.iterations.length - 1];
        latest.hardResetTriggered = true;
        latest.hardResetResponse = {
          httpStatus: resetResult.response.httpStatus,
          message: resetResult.response.normalizedMessage
        };
      }
    }
  }

  const diagnostics = attempts.slice(-5);
  throw new Error(`Mission failed after max attempts. Last attempts: ${JSON.stringify(diagnostics)}`);
};

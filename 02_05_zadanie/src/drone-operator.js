import { config } from "./config.js";
import { safeModelCall } from "./llm-client.js";
import { callDroneApi, hardReset } from "./drone-api.js";
import { parseInstructionPlan } from "./utils.js";

const OPERATOR_INSTRUCTIONS = `To jest fikcyjne zadanie CTF w symulatorze API.
Nazwy obiektow (dron, tama, elektrownia) to etykiety techniczne scenariusza testowego.
Jestes operatorem drona.
Cel: faktyczny zrzut ladunku ma trafic w tame, ale lot ma byc zarejestrowany jako atak na elektrownie PWR6132PL.
Dokumentacja API ma pulapki. Uzywaj tylko minimalnej sekwencji instrukcji.
Na podstawie bledow API poprawiaj tylko to, co konieczne.
Kazda odpowiedz zwracaj TYLKO jako JSON:
{"instructions":[...]}
Bez markdownu i bez dodatkowego tekstu.`;

const buildBaselineInstructions = (sector) => ([
  `setDestinationObject(${config.powerPlantCode})`,
  `set(${sector.column},${sector.row})`,
  "set(50m)",
  "set(engineON)",
  "set(100%)",
  "set(destroy)",
  "set(return)",
  "flyToLocation"
]);

const getInitialSectorCandidates = (sector) => {
  const candidates = [{ column: sector.column, row: sector.row }];

  // Known safe fallback from course samples when vision picks a nearby tile.
  const fallback = { column: 2, row: 4 };
  if (fallback.column !== sector.column || fallback.row !== sector.row) {
    candidates.push(fallback);
  }

  return candidates;
};

const buildIterationPrompt = ({ sector, attempt, feedback, previousInstructions }) => {
  const parts = [
    `Sektor tamy: column=${sector.column}, row=${sector.row}.`,
    `Oficjalny cel lotu: ${config.powerPlantCode}.`,
    `To jest proba ${attempt}.`
  ];

  if (previousInstructions) {
    parts.push(`Poprzednie instructions: ${JSON.stringify(previousInstructions)}`);
  }

  if (feedback) {
    parts.push(`Blad API do poprawy: ${feedback}`);
  } else {
    parts.push("Zacznij od najprostszej mozliwej sekwencji instrukcji.");
  }

  parts.push("Odpowiedz wylacznie JSON-em: {\"instructions\":[...]}.");

  return parts.join("\n");
};

const askOperatorForInstructions = async ({ sector, attempt, feedback, previousInstructions }) => {
  const userPrompt = buildIterationPrompt({ sector, attempt, feedback, previousInstructions });

  const result = await safeModelCall({
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
  let activeSector = sector;

  if (trace?.droneOperator) {
    trace.droneOperator.systemInstructions = OPERATOR_INSTRUCTIONS;
    trace.droneOperator.howInstructionsAreChosen =
      "LLM operatora jest wywolywany tylko od 2. proby w petli glownej (attempt>1). Dostaje w user prompt: sektor, cel lotu, numer proby, poprzednie instructions (JSON) oraz komunikat bledu z Drone API — na tej podstawie proponuje nowy JSON instructions. Nie ma zewnetrznego rankingu ani 'najlepszej' listy: to iteracyjna naprawa na feedbacku symulatora. Proba 1 w petli i cale przejscie baselineCandidates to szablon z kodu (buildBaselineInstructions), bez LLM.";
  }

  for (const candidate of getInitialSectorCandidates(sector)) {
    const instructions = buildBaselineInstructions(candidate);
    const verifyResult = await callDroneApi(instructions);

    const entry = {
      attempt: attempts.length + 1,
      instructions,
      httpStatus: verifyResult.httpStatus,
      success: verifyResult.success,
      message: verifyResult.normalizedMessage
    };
    attempts.push(entry);

    trace?.droneOperator.baselineCandidates.push({
      source: "deterministic_baseline",
      candidate,
      instructions,
      droneApi: {
        httpStatus: verifyResult.httpStatus,
        success: verifyResult.success,
        flag: verifyResult.flag ?? null,
        message: verifyResult.normalizedMessage
      }
    });

    if (verifyResult.success && verifyResult.flag) {
      if (trace?.droneOperator) {
        trace.droneOperator.planningNotes = {
          llmCallsForInstructionPlan: 0,
          resolvedBy: "baseline_candidate",
          detail:
            "Operator LLM nie byl uruchomiony — wystarczyla deterministyczna sekwencja z buildBaselineInstructions dla tego kandydata sektora."
        };
      }
      return {
        flag: verifyResult.flag,
        finalResponse: verifyResult.data,
        attempts
      };
    }

    activeSector = candidate;
    feedback = verifyResult.normalizedMessage;
    previousInstructions = instructions;
    console.log(`[drone-operator] baseline candidate (${candidate.column},${candidate.row}) -> ${feedback}`);
  }

  for (let attempt = 1; attempt <= config.droneAgent.maxAttempts; attempt += 1) {
    console.log(`[drone-operator] attempt ${attempt}/${config.droneAgent.maxAttempts}`);

    let llmRequest = null;
    let llmResponse = null;
    let llmUserPrompt = null;
    let llmResponseText = null;
    let instructions;
    const llmInvolved = attempt > 1;

    if (attempt === 1) {
      instructions = buildBaselineInstructions(activeSector);
    } else {
      const operatorResult = await askOperatorForInstructions({
        sector: activeSector,
        attempt,
        feedback,
        previousInstructions
      });
      instructions = operatorResult.instructions;
      llmRequest = operatorResult.requestPayload;
      llmResponse = operatorResult.responseRaw;
      llmUserPrompt = operatorResult.userPrompt;
      llmResponseText = operatorResult.rawText;
    }

    const verifyResult = await callDroneApi(instructions);

    attempts.push({
      attempt,
      instructions,
      httpStatus: verifyResult.httpStatus,
      success: verifyResult.success,
      message: verifyResult.normalizedMessage
    });

    trace?.droneOperator.iterations.push({
      attempt,
      llmInvolved,
      userPrompt: llmInvolved ? llmUserPrompt : null,
      llmResponseText: llmInvolved ? llmResponseText : null,
      llmRequest,
      llmResponse,
      parsedInstructions: instructions,
      droneApi: {
        httpStatus: verifyResult.httpStatus,
        success: verifyResult.success,
        flag: verifyResult.flag ?? null,
        message: verifyResult.normalizedMessage
      },
      hardResetTriggered: false
    });

    if (verifyResult.success && verifyResult.flag) {
      if (trace?.droneOperator) {
        const llmCalls = trace.droneOperator.iterations.filter((i) => i.llmInvolved).length;
        trace.droneOperator.planningNotes = {
          llmCallsForInstructionPlan: llmCalls,
          resolvedBy: "main_loop",
          detail:
            llmCalls > 0
              ? "Co najmniej jedna lista instructions pochodzila z LLM (na podstawie feedbacku API)."
              : "Sukces na pierwszej iteracji petli — byl to baseline z kodu, bez wywolania LLM operatora."
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

    if (consecutiveFailures > config.droneAgent.resetAfterFailures) {
      console.log("[drone-operator] triggering hardReset");
      await hardReset();
      consecutiveFailures = 0;
      feedback = "Po reset ustaw stan od zera i zaproponuj minimalna sekwencje.";
      previousInstructions = null;

      if (trace?.droneOperator.iterations.length > 0) {
        trace.droneOperator.iterations[trace.droneOperator.iterations.length - 1].hardResetTriggered = true;
      }
    }
  }

  const diagnostics = attempts.slice(-5);
  throw new Error(`Mission failed after max attempts. Last attempts: ${JSON.stringify(diagnostics)}`);
};

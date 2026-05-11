import { config } from "./config.js";
import { printModelInfo } from "./llm-client.js";
import { runMapAnalyst } from "./map-analyst.js";
import { runDroneOperator } from "./drone-operator.js";
import { createRunTrace, saveTrace, saveFlagTxt } from "./tracer.js";

export const runMission = async () => {
  console.log("[mission] starting drone mission");
  console.log(`[mission] map url: ${config.mapUrl.replace(config.ag3ntsApiKey, "***")}`);
  printModelInfo();

  const trace = createRunTrace(config);
  let sector = null;

  try {
    sector = await runMapAnalyst({ trace });
    const result = await runDroneOperator({ sector, trace });

    const tracePath = await saveTrace(trace, {
      status: "success",
      sector,
      flag: result.flag,
      attempts: result.attempts,
      errorMessage: null
    });
    console.log(`[trace] saved -> ${tracePath}`);

    const flagPath = await saveFlagTxt(result.flag);
    if (flagPath) {
      console.log(`[mission] FLG saved -> ${flagPath}`);
    }

    return {
      sector,
      ...result
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fallbackAttempts = trace?.droneOperator?.iterations ?? [];

    try {
      const tracePath = await saveTrace(trace, {
        status: "failed",
        sector,
        flag: null,
        attempts: fallbackAttempts,
        errorMessage
      });
      console.log(`[trace] saved (failed run) -> ${tracePath}`);
    } catch (traceError) {
      const traceSaveMessage = traceError instanceof Error ? traceError.message : String(traceError);
      console.warn(`[trace] failed to save failed-run trace: ${traceSaveMessage}`);
    }

    throw error;
  }
};

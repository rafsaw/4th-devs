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

  const sector = await runMapAnalyst({ trace });
  const result = await runDroneOperator({ sector, trace });

  const tracePath = await saveTrace(trace, { sector, flag: result.flag, attempts: result.attempts });
  console.log(`[trace] saved -> ${tracePath}`);

  const flagPath = await saveFlagTxt(result.flag);
  if (flagPath) {
    console.log(`[mission] FLG saved -> ${flagPath}`);
  }

  return {
    sector,
    ...result
  };
};

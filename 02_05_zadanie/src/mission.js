import { config } from "./config.js";
import { printModelInfo } from "./llm-client.js";
import { runMapAnalyst } from "./map-analyst.js";
import { runDroneOperator } from "./drone-operator.js";

export const runMission = async () => {
  console.log("[mission] starting drone mission");
  console.log(`[mission] map url: ${config.mapUrl.replace(config.ag3ntsApiKey, "***")}`);
  printModelInfo();

  const sector = await runMapAnalyst();
  const result = await runDroneOperator({ sector });

  return {
    sector,
    ...result
  };
};

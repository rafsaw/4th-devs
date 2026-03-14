import { runWorkflow } from "./workflow.js";
import {
  getDefaultResultPath,
  prepareVerifyPayload,
  saveVerifyResult,
  verifyAnswer,
} from "./verify.js";

const resolveAiDevsApiKey = () => {
  const key = (process.env.AI_DEVS_4_KEY ?? "").trim();

  if (!key) {
    throw new Error(
      "Missing AI Devs key. Set AI_DEVS_4_KEY in your environment.",
    );
  }

  return key;
};

const runDeterministicFinalize = async ({ apiKey, report }) => {
  const payload = prepareVerifyPayload({
    apiKey,
    winner: report.winner,
  });

  const verifyResponse = await verifyAnswer(payload);
  const outputPath = await saveVerifyResult({ report, verifyResponse });

  return {
    payload,
    verifyResponse,
    outputPath,
  };
};

const main = async () => {
  const apiKey = resolveAiDevsApiKey();

  const { state, finalText } = await runWorkflow({ apiKey });
  const finalize = await runDeterministicFinalize({
    apiKey,
    report: state.report,
  });

  console.log("[workflow] assistant summary:");
  console.log(finalText || "(no textual summary)");
  console.log("");
  console.log("[workflow] winner:");
  console.log(state.report.winner);
  console.log("");
  console.log("[verify] response:");
  console.log(finalize.verifyResponse);
  console.log("");
  console.log(`[verify] result written to ${getDefaultResultPath()}`);
};

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

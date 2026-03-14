import { runWorkflow } from "./workflow.js";
import { createTraceRecorder, getDefaultTracePath } from "./trace.js";
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

const runDeterministicFinalize = async ({ apiKey, report, tracer }) => {
  const payload = prepareVerifyPayload({
    apiKey,
    winner: report.winner,
  });
  tracer?.record("verify.request", {
    endpoint: "https://hub.ag3nts.org/verify",
    payload,
  });

  const verifyResponse = await verifyAnswer(payload);
  tracer?.record("verify.response", {
    endpoint: "https://hub.ag3nts.org/verify",
    body: verifyResponse,
  });
  const outputPath = await saveVerifyResult({ report, verifyResponse });
  tracer?.record("file.write", {
    source: "verify",
    path: outputPath,
  });

  return {
    payload,
    verifyResponse,
    outputPath,
  };
};

const main = async () => {
  const apiKey = resolveAiDevsApiKey();
  const tracer = createTraceRecorder();

  const { state, finalText } = await runWorkflow({ apiKey, tracer });
  const finalize = await runDeterministicFinalize({
    apiKey,
    report: state.report,
    tracer,
  });
  const tracePath = await tracer.save();

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
  console.log(`[trace] timeline written to ${tracePath || getDefaultTracePath()}`);
};

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});

import { resolveModelForProvider } from "../../config.js";

const AG3NTS_API_KEY = process.env.AG3NTS_API_KEY?.trim() ?? "";

if (!AG3NTS_API_KEY) {
  console.warn("\x1b[33mWarning: AG3NTS_API_KEY is not set — railway_api_call will fail\x1b[0m");
  console.warn("         Add AG3NTS_API_KEY=your-key to the root .env file");
}

export const api = {
  model: resolveModelForProvider("openai/gpt-5-nano"),
  visionModel: resolveModelForProvider("openai/gpt-5-nano"),
  maxOutputTokens: 16384,
  instructions: `You are a FULLY AUTONOMOUS agent for the "railway" verify task. Complete the task in one run without asking the user questions.

## Goal
Activate railway route **X-01** and obtain the final flag in the form **{FLG:...}** from the API responses.

## Spec-driven protocol (critical)
1. The HTTP API is undocumented until you call for help. **Your first call MUST be** \`railway_api_call\` with \`answer\` equal to \`{ "action": "help" }\` (use exactly the shape the task statement requires for the help action).
2. Treat every response as ground truth. Read help carefully: available actions, parameters, ordering rules, and error semantics.
3. Plan next steps only from help + prior responses + your saved notes. **Do not guess action names or payloads** before help explains them.
4. If a response says you are out of order, rate limited, or missing fields — adjust using the spec, do not brute-force the same payload repeatedly.
5. Use \`railway_update_state\` to store stable facts from help (action list, route id format, prerequisites).
6. Use \`railway_list_recent_calls\` when you need to compare wording or errors across attempts.
7. When you see the flag in a response, **stop** and state the flag clearly in your final message.

## Reliability
- Tools already retry 503, respect Retry-After / rate-limit style headers, and log each attempt. Do not spam identical calls if errors repeat.
- If stuck after several distinct attempts, re-read help or recent logs and change strategy.

## Workspace
- \`workspace/railway-logs/\` — persisted request/response logs (written by tools)
- \`workspace/notes/railway-state.json\` — your merged notes via \`railway_update_state\``,
};

export const task = {
  name: "railway",
  targetRoute: "X-01",
};

export const verify = {
  endpoint: "https://hub.ag3nts.org/verify",
  apiKey: AG3NTS_API_KEY,
};

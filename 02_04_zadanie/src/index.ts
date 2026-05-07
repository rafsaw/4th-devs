import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { zmailHelp, zmailSearch, zmailGetMessages, zmailGetInbox, zmailGetThread } from "./zmail.js";
import { verify, type Answer } from "./hub.js";
import { tools, SEC_REGEX, DATE_REGEX } from "./tools.js";
import { buildSystemPrompt, wrapUntrusted } from "./prompt.js";

const OUTPUT_DIR = path.resolve("output");

const client = new OpenAI({
  apiKey: config.openrouterKey,
  baseURL: "https://openrouter.ai/api/v1",
});

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface RunResult {
  flag: string | null;
  iterations: number;
  finishReason: string;
  conversation: ChatMessage[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logIter(iter: number, ...rest: unknown[]) {
  console.log(`[iter ${iter}]`, ...rest);
}

async function saveFlag(flag: string): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, "flag.txt"), flag + "\n", "utf8");
}

async function saveRun(result: RunResult): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.writeFile(
    path.join(OUTPUT_DIR, `run-${stamp}.json`),
    JSON.stringify(result, null, 2),
    "utf8",
  );
}

async function handleSubmitAnswer(
  args: Answer,
): Promise<{ toolText: string; flag: string | null }> {
  if (args.confirmation_code && !SEC_REGEX.test(args.confirmation_code)) {
    return {
      toolText: JSON.stringify({
        ok: false,
        error: `confirmation_code '${args.confirmation_code}' nie pasuje do ^SEC-.{32}$ (długość ${args.confirmation_code.length}). Nie wysłano do huba — szukaj poprawnej wartości.`,
      }),
      flag: null,
    };
  }
  if (args.date && !DATE_REGEX.test(args.date)) {
    return {
      toolText: JSON.stringify({
        ok: false,
        error: `date '${args.date}' nie pasuje do YYYY-MM-DD. Nie wysłano do huba.`,
      }),
      flag: null,
    };
  }
  if (!args.date && !args.password && !args.confirmation_code) {
    return {
      toolText: JSON.stringify({
        ok: false,
        error: "Pusty answer — podaj przynajmniej jedno pole.",
      }),
      flag: null,
    };
  }
  const result = await verify(args);
  return {
    toolText: JSON.stringify({
      ok: true,
      sent: args,
      hub_response: result.raw,
      flag_detected: result.flag,
    }),
    flag: result.flag,
  };
}

async function runTool(name: string, args: any): Promise<{ text: string; flag?: string | null; finish?: string }> {
  switch (name) {
    case "zmail_search": {
      const data = await zmailSearch(String(args.query ?? ""), Number(args.page ?? 1));
      return { text: JSON.stringify(data) };
    }
    case "zmail_get_inbox": {
      const data = await zmailGetInbox(Number(args.page ?? 1));
      return { text: JSON.stringify(data) };
    }
    case "zmail_get_thread": {
      const data = await zmailGetThread(args.thread_id);
      return { text: JSON.stringify(data) };
    }
    case "zmail_read": {
      const ids = Array.isArray(args.ids) ? args.ids : [args.message_id ?? args.id];
      const data = await zmailGetMessages(ids);
      const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      return { text: wrapUntrusted(body) };
    }
    case "submit_answer": {
      const r = await handleSubmitAnswer(args as Answer);
      return { text: r.toolText, flag: r.flag };
    }
    case "wait_seconds": {
      const s = Math.min(30, Math.max(1, Number(args.seconds ?? 10)));
      await sleep(s * 1000);
      return { text: JSON.stringify({ ok: true, slept_seconds: s }) };
    }
    case "finish": {
      return { text: JSON.stringify({ ok: true }), finish: String(args.reason ?? "") };
    }
    default:
      return { text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }) };
  }
}

async function run(): Promise<RunResult> {
  console.log("[boot] zmail help...");
  const help = await zmailHelp();
  const helpInfo = typeof help === "string" ? help : JSON.stringify(help, null, 2);
  console.log("[boot] help loaded:", helpInfo.slice(0, 200), helpInfo.length > 200 ? "…" : "");

  const system = buildSystemPrompt(helpInfo);
  const conversation: ChatMessage[] = [{ role: "system", content: system }];

  let flag: string | null = null;
  let finishReason = "max_iter";
  let iter = 0;

  for (iter = 1; iter <= config.maxIter; iter++) {
    const completion = await client.chat.completions.create({
      model: config.model,
      messages: conversation,
      tools,
      tool_choice: "auto",
      temperature: 0,
    });
    const msg = completion.choices[0]?.message;
    if (!msg) {
      finishReason = "no_message";
      break;
    }
    conversation.push(msg as ChatMessage);

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      logIter(iter, "model returned no tool_calls — stopping", { content: msg.content });
      finishReason = "no_tool_calls";
      break;
    }

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      let args: any = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (e) {
        args = { _raw: call.function.arguments };
      }
      logIter(iter, "tool", name, args);

      let toolResult: { text: string; flag?: string | null; finish?: string };
      try {
        toolResult = await runTool(name, args);
      } catch (e) {
        toolResult = {
          text: JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }),
        };
      }

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: toolResult.text,
      });

      if (toolResult.flag) {
        flag = toolResult.flag;
        logIter(iter, "FLAG DETECTED:", flag);
      }
      if (toolResult.finish) {
        finishReason = `finish: ${toolResult.finish}`;
        return { flag, iterations: iter, finishReason, conversation };
      }
    }

    if (flag) {
      finishReason = "flag_received";
      conversation.push({
        role: "user",
        content: `Otrzymałeś flagę ${flag}. Wywołaj teraz finish.`,
      });
    }
  }

  return { flag, iterations: iter, finishReason, conversation };
}

async function main() {
  try {
    const result = await run();
    if (result.flag) {
      await saveFlag(result.flag);
      console.log(`\n[OK] FLAGA: ${result.flag}`);
      console.log(`Zapisano do: ${path.join(OUTPUT_DIR, "flag.txt")}`);
    } else {
      console.log(
        `\n[FAIL] Brak flagi po ${result.iterations} iteracjach. Powod: ${result.finishReason}`,
      );
    }
    await saveRun(result);
    process.exit(result.flag ? 0 : 1);
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(2);
  }
}

main();

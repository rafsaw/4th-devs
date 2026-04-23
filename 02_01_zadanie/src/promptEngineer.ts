import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppConfig } from "./config.js";
import { refineCandidate } from "./prompting.js";
import { TokenEstimator } from "./tokenEstimator.js";
import type { ExperimentIteration, PromptCandidate } from "./types.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
}

// [prompt.md] "Rola kontekstu w instrukcjach systemowych"
// System prompt pełni rolę elastycznej "mapy" środowiska — dostarcza agentowi zgeneralizowane
// rozumienie celu i ograniczeń bez konkretnych instrukcji per-item, które byłyby szumem.
// Szczegóły każdej próby (co się nie powiodło, ile tokenów) trafiają do wiadomości użytkownika.
//
// [prompt.md] "Generalizowanie zasad przetwarzania kontekstu"
// System prompt zawiera jawne ostrzeżenie przed "przesterowaniem" (overfitting):
// model ma identyfikować KATEGORIĘ problemu, a nie tworzyć reguły dla konkretnego przedmiotu.
const SYSTEM_PROMPT = `You are a prompt engineer optimising a cargo classifier that runs on a tiny model.

Environment:
- The classifier receives: [your static prefix] + newline + [item line, e.g. "Item 7: Hatchet with sharpened head"]
- Token budget: prefix + newline + item_line ≤ 100 tokens (tiktoken cl100k_base). Keep prefix ≤ 78 tokens.
- Write in English — it tokenises efficiently.

Your prefix must enforce:
- Output: ONLY "DNG" or "NEU", nothing else
- DNG = dangerous goods (explosive, flammable, corrosive, toxic, radioactive, weapon, biohazard)
- NEU = safe / neutral goods
- HARD EXCEPTION: items mentioning "reactor" or "fuel rod" are always NEU regardless of other content

How to reason about failures:
1. Identify the CATEGORY the failing item belongs to (not the item itself).
2. Ask: does my current rule cover that category correctly?
3. Write a GENERALISED rule for the category — not a rule for the specific item.

WARNING — avoid overfitting:
Do NOT add rules like "NEU if fan blade" or "DNG if hatchet".
Such item-specific rules will fail on unseen data. Aim for universal, principled coverage.
If you feel the urge to name a specific item in your rule, step back and name its category instead.

Each turn you receive a concise failure digest. Learn from the full conversation history.
Do not repeat a prefix already tried.

Return ONLY the new prefix text. No JSON, no markdown, no explanation.`;

const tokenEstimator = new TokenEstimator();

// [prompt.md] "Odróżnianie szumu od sygnału z pomocą modelu"
// Przed przekazaniem informacji agentowi filtrujemy odpowiedzi huba w kodzie.
// Agent dostaje tylko czystą esencję błędów:
//   - opisy przedmiotów odrzuconych przez huba + powód odrzucenia
//   - worst-case token footprint (zamiast surowych JSON-ów per item)
// Usunięte: rawResponse (pełne JSON-y z huba) — to był szum, nie sygnał.
//
// [prompt.md] "Kształtowanie kontekstu poprzez obserwacje"
// Każda wiadomość buduje na poprzednich turach (historia w `this.history`),
// dzięki czemu agent widzi pełny obraz swoich poprzednich prób i może wyciągać wnioski.
function buildUserMessage(current: PromptCandidate, iteration: ExperimentIteration): string {
  const prefixTokens = tokenEstimator.estimate(current.staticPrefix, 100).tokens;

  // Only items the hub explicitly rejected or that returned unparseable output.
  const rejectedItems = iteration.results
    .filter((r) => r.verify.error !== undefined || r.verify.normalized === "INVALID");

  const failureLines = rejectedItems.length > 0
    ? rejectedItems.map((r) => {
        const reason = r.verify.normalized === "INVALID"
          ? "model output could not be parsed as DNG/NEU"
          : `hub rejected: ${r.verify.error}`;
        return `  • "${r.item.description}" → ${reason}`;
      }).join("\n")
    : "  (none — budget or token-limit issue)";

  // Worst-case token footprint across items actually sent this iteration.
  const tokenLines = iteration.results.length > 0
    ? (() => {
        const worst = iteration.results.reduce((a, b) =>
          a.tokenEstimate.tokens >= b.tokenEstimate.tokens ? a : b
        );
        const worstSuffix = worst.tokenEstimate.tokens - prefixTokens - 1;
        return `  worst case: prefix=${prefixTokens} + newline=1 + item_line≈${worstSuffix} = ${worst.tokenEstimate.tokens}/100 tokens`;
      })()
    : `  prefix=${prefixTokens} tokens (no items sent)`;

  return `--- Attempt summary ---
Prefix tried (${prefixTokens} tokens):
"${current.staticPrefix}"

Items sent: ${iteration.results.length}/10
Hub stop reason: ${iteration.hubError ?? "(none)"}

Failure digest (items the hub rejected):
${failureLines}

Token budget check:
${tokenLines}

--- Your task ---
Identify the CATEGORY behind the failing items and write a GENERALISED rule.
Do not name the specific items. Aim for universal coverage.
New prefix must be ≤ 78 tokens. Return the prefix text only.`;
}

export class PromptEngineer {
  // [prompt.md] "Kształtowanie kontekstu poprzez obserwacje"
  // Historia multi-turn przechowuje wszystkie poprzednie próby i odpowiedzi agenta.
  // Agent samodzielnie analizuje porażki i dynamicznie dostosowuje podejście,
  // kierując się informacją zwrotną z huba widoczną w kolejnych wiadomościach.
  private readonly history: ChatMessage[] = [];

  constructor(private readonly config: AppConfig) {}

  async refine(
    current: PromptCandidate,
    iteration: ExperimentIteration,
    nextId: string,
    runId: string
  ): Promise<PromptCandidate> {
    if (!this.config.openrouterApiKey) {
      console.warn("[PromptEngineer] No OPENROUTER_API_KEY — falling back to rule-based refinement.");
      return refineCandidate(current, iteration.hypothesisForNextRevision ?? "classification mismatch", nextId);
    }

    const chatPath = resolve(this.config.stateDir, `engineer_chat_${runId}.json`);

    const userMessage = buildUserMessage(current, iteration);
    this.history.push({ role: "user", content: userMessage });

    console.log(`[PromptEngineer] Calling engineer (history length: ${this.history.length} messages)…`);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.openrouterApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.engineerModel,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...this.history],
          max_tokens: 200,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenRouter ${response.status}: ${err}`);
      }

      const data = (await response.json()) as OpenRouterResponse;
      const raw = data.choices[0]?.message?.content?.trim();

      if (!raw) {
        throw new Error("Empty response from engineer model");
      }

      // Strip any reasoning text — take only the last non-empty paragraph as the prompt.
      const paragraphs = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      const newPrefix = paragraphs.at(-1) ?? raw;

      // Save assistant reply to history so the next iteration sees what was already tried.
      this.history.push({ role: "assistant", content: newPrefix });

      await this.saveChat(chatPath, runId);
      console.log(`[PromptEngineer] New prefix (${nextId}):\n  "${newPrefix}"`);

      return {
        id: nextId,
        staticPrefix: newPrefix,
        dynamicSuffixTemplate: current.dynamicSuffixTemplate,
        rationale: `LLM-refined from ${current.id}: ${(iteration.hubError ?? "mismatch").slice(0, 80)}`
      };
    } catch (error) {
      // On failure remove the user message we just pushed so history stays consistent.
      this.history.pop();
      console.warn(`[PromptEngineer] LLM call failed (${String(error)}), falling back to rule-based refinement.`);
      return refineCandidate(current, iteration.hypothesisForNextRevision ?? "classification mismatch", nextId);
    }
  }

  // [prompt.md] "Kontrola stanu interakcji poza oknem kontekstu"
  // Historia rozmów jest zapisywana asynchronicznie do pliku engineer_chat_<runId>.json
  // po każdej turze. Dzięki temu pamięć o testowanych promptach i błędach istnieje
  // poza oknem kontekstowym modelu i jest trwała między uruchomieniami.
  private async saveChat(chatPath: string, runId: string): Promise<void> {
    const payload = {
      runId,
      savedAt: new Date().toISOString(),
      totalTurns: Math.floor(this.history.length / 2),
      conversation: this.history.map((msg, index) => ({
        turn: Math.floor(index / 2) + 1,
        role: msg.role,
        content: msg.content
      }))
    };
    await mkdir(this.config.stateDir, { recursive: true });
    await writeFile(chatPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }
}

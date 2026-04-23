import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BudgetState, SessionState } from "./types.js";

const defaultBudgetState: BudgetState = {
  spentPp: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  requests: 0,
  resets: 0
};

export class SessionStateManager {
  private readonly sessionPath: string;
  private readonly budgetPath: string;
  private readonly bestPromptPath: string;
  private readonly flagPath: string;
  // [prompt.md] "Współdzielenie informacji pomiędzy wątkami"
  // Outbox to dedykowany katalog workspace/sessions/outbox/ dla artefaktów wynikowych.
  // Inne agenty w systemie mogą pobierać stamtąd flagę i zwycięski prompt
  // bez bezpośredniego sprzężenia ze strukturą katalogu state/.
  private readonly outboxDir: string;

  constructor(stateDir: string) {
    this.sessionPath = resolve(stateDir, "session.json");
    this.budgetPath = resolve(stateDir, "budget_state.json");
    this.bestPromptPath = resolve(stateDir, "best_prompt.json");
    this.flagPath = resolve(stateDir, "flag.json");
    this.outboxDir = resolve(stateDir, "..", "workspace", "sessions", "outbox");
  }

  async saveSession(state: SessionState): Promise<void> {
    await this.writeJson(this.sessionPath, state);
  }

  async loadBudget(): Promise<BudgetState> {
    return this.readJson<BudgetState>(this.budgetPath, defaultBudgetState);
  }

  async saveBudget(state: BudgetState): Promise<void> {
    await this.writeJson(this.budgetPath, state);
  }

  async saveBestPrompt(payload: { candidateId: string; prompt: string; score: number }): Promise<void> {
    await this.writeJson(this.bestPromptPath, {
      updatedAt: new Date().toISOString(),
      ...payload
    });
  }

  async saveFlag(flag: string, context: { runId: string; iteration: number; prompt: string }): Promise<void> {
    await this.writeJson(this.flagPath, {
      flag,
      capturedAt: new Date().toISOString(),
      ...context
    });
  }

  // [prompt.md] "Współdzielenie informacji pomiędzy wątkami"
  // Zapisuje zwycięski prompt i flagę do workspace/sessions/outbox/,
  // aby inne agenty w systemie mogły skonsumować te artefakty.
  // Generuje dwa pliki:
  //   - flag.json         — flaga + metadane (runId, iteracja, timestamp)
  //   - winning_prompt.md — zwycięski prefix w formacie Markdown gotowym do przeczytania
  async saveToOutbox(context: { flag: string; prompt: string; runId: string; iteration: number }): Promise<void> {
    await mkdir(this.outboxDir, { recursive: true });
    const capturedAt = new Date().toISOString();

    await this.writeJson(resolve(this.outboxDir, "flag.json"), {
      flag: context.flag,
      capturedAt,
      runId: context.runId,
      iteration: context.iteration
    });

    const promptMd = [
      `# Winning Prompt`,
      ``,
      `- Captured: ${capturedAt}`,
      `- Run: ${context.runId}`,
      `- Iteration: ${context.iteration}`,
      `- Flag: \`${context.flag}\``,
      ``,
      `## Prefix`,
      ``,
      `\`\`\``,
      context.prompt,
      `\`\`\``,
    ].join("\n");
    await writeFile(resolve(this.outboxDir, "winning_prompt.md"), `${promptMd}\n`, "utf-8");

    console.log(`   Outbox → workspace/sessions/outbox/ (flag.json + winning_prompt.md)`);
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
}

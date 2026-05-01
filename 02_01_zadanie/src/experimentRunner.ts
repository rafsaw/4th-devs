import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { BudgetManager } from "./budgetManager.js";
import { HubClient } from "./hubClient.js";
import { promptCandidates, renderPrompt } from "./prompting.js";
import { PromptEngineer } from "./promptEngineer.js";
import { SessionStateManager } from "./stateManager.js";
import { TokenEstimator } from "./tokenEstimator.js";
import { TraceLogger } from "./traceLogger.js";
import type { CsvItem, ExperimentIteration, Label, PromptCandidate, SessionState } from "./types.js";

interface RunnerDeps {
  config: AppConfig;
  trace: TraceLogger;
  stateManager: SessionStateManager;
}

// [prompt.md] "Planowanie i monitorowanie postępów"
// Lista zadań (TODO) śledzi w pamięci postęp przetwarzania każdego z 10 elementów CSV.
// Każdy item zaczyna jako "pending" i przechodzi przez: accepted | rejected | skipped.
// Status "skipped" oznacza: iteracja przerwana wcześniej (błąd lub limit budżetu),
// więc ten item nie został jeszcze wysłany do huba — oszczędność budżetu.
interface ItemTask {
  id: string;
  description: string;
  status: "pending" | "accepted" | "rejected" | "skipped";
  normalized?: string;
}

function expectedLocalLabel(item: CsvItem): Label {
  const normalized = item.description.toLowerCase();
  // Reactor/fuel cassette items must always be NEU regardless of content.
  if (/\b(reactor|fuel rod|fuel cassette)\b/.test(normalized)) {
    return "NEU";
  }
  // Weapons and dangerous goods — keyword and semantic patterns.
  if (/\b(explosive|flammable|radioactive|corrosive|toxic|biohazard|ammunition|ammo)\b/.test(normalized)) {
    return "DNG";
  }
  if (/\b(gun|rifle|pistol|shotgun|revolver|firearm|handgun)\b/.test(normalized)) {
    return "DNG";
  }
  if (/\b(knife|knives|blade|dagger|machete|sword|cleaver|combat knife|serrated)\b/.test(normalized)) {
    return "DNG";
  }
  if (/\b(crossbow|bow|arrow|bolt|quiver)\b/.test(normalized)) {
    return "DNG";
  }
  if (/\b(grenade|bomb|mine|ied|detonator|fuse|warhead)\b/.test(normalized)) {
    return "DNG";
  }
  if (/\b(uranium|plutonium|enriched|nuclear|chemical weapon|nerve agent)\b/.test(normalized)) {
    return "DNG";
  }
  return "NEU";
}

function inferHypothesis(iteration: ExperimentIteration): string {
  const invalid = iteration.results.find((result) => result.verify.normalized === "INVALID");
  if (invalid) {
    return "format error: model did not output strict DNG/NEU.";
  }
  const overLimit = iteration.results.find((result) => !result.tokenEstimate.withinLimit);
  if (overLimit) {
    return "too long: prompt exceeded token limit.";
  }
  const reactorMiss = iteration.results.find(
    (result) =>
      result.expected &&
      result.verify.normalized !== "INVALID" &&
      result.verify.normalized !== result.expected &&
      /reactor/i.test(result.item.description)
  );
  if (reactorMiss) {
    return "reactor missed: hazard-specific vocabulary unclear.";
  }
  return iteration.hubError ? `hub error observed: ${iteration.hubError}` : "classification mismatch; tighten hazard criteria.";
}

export class ExperimentRunner {
  private readonly tokenEstimator = new TokenEstimator();
  private readonly hubClient: HubClient;
  private readonly promptEngineer: PromptEngineer;

  constructor(private readonly deps: RunnerDeps) {
    this.hubClient = new HubClient(deps.config);
    this.promptEngineer = new PromptEngineer(deps.config);
  }

  async run(): Promise<void> {
    const runId = randomUUID();
    await this.deps.trace.startRun(runId, {
      mode: this.deps.config.mode,
      maxIterations: this.deps.config.maxIterations,
      tokenLimit: this.deps.config.tokenLimit,
      budgetLimitPp: this.deps.config.budgetLimitPp,
      verifyUrl: this.deps.config.verifyUrl
    });
    const budgetState = await this.deps.stateManager.loadBudget();
    const budget = new BudgetManager(this.deps.config.budgetLimitPp, budgetState);
    const session: SessionState = {
      runId,
      mode: this.deps.config.mode,
      startedAt: new Date().toISOString(),
      currentIteration: 0,
      bestScore: 0,
      status: "running"
    };
    await this.deps.stateManager.saveSession(session);

    await this.deps.trace.logTrace("plan.created", {
      runId,
      steps: [
        "fetch CSV",
        "estimate token cost",
        "generate candidate prompt",
        "run full cycle",
        "inspect failures",
        "refine prompt",
        "retry",
        "summarize best result"
      ]
    });
    await this.deps.trace.logStep(runId, "run.started", {
      session,
      budgetState
    });

    // Fetch fresh CSV before every remote attempt.
    let csvItems: CsvItem[] = [];
    let activeCandidate: PromptCandidate = promptCandidates[0];

    for (let i = 1; i <= this.deps.config.maxIterations; i += 1) {
      session.currentIteration = i;
      await this.deps.stateManager.saveSession(session);
      await this.deps.trace.logStep(runId, "iteration.started", {
        iteration: i,
        candidateId: activeCandidate.id,
        promptPrefix: activeCandidate.staticPrefix
      });

      // Requirement: fetch fresh CSV before each full attempt.
      csvItems = await this.loadItems();
      await this.deps.trace.logStep(runId, "csv.fetched", {
        iteration: i,
        itemCount: csvItems.length,
        ids: csvItems.map((item) => item.id)
      });

      console.log(`\n── Iteration ${i}/${this.deps.config.maxIterations} ─────────────────────────`);
      console.log(`   Prompt [${activeCandidate.id}]: "${activeCandidate.staticPrefix.slice(0, 80)}${activeCandidate.staticPrefix.length > 80 ? "…" : ""}"`);

      const iteration = await this.runIteration(runId, i, csvItems, activeCandidate, budget);
      await this.deps.trace.logExperiment(iteration);

      // Score = items the hub accepted (no error, valid DNG/NEU). Hub is the oracle.
      const score = iteration.results.filter((r) => r.verify.error === undefined && r.verify.normalized !== "INVALID").length;

      // Display TODO list: processed items first, then skipped (not reached this iteration).
      const processedIds = new Set(iteration.results.map((r) => r.item.id));
      for (const result of iteration.results) {
        const ok = result.verify.error === undefined && result.verify.normalized !== "INVALID";
        const mark = ok ? "✓" : "✗";
        const flagLabel = result.verify.flag ? ` 🚩 ${result.verify.flag}` : "";
        console.log(`   ${mark} item ${result.item.id.padEnd(8)} [${result.verify.normalized}] "${result.item.description}"${flagLabel}`);
      }
      for (const item of csvItems) {
        if (!processedIds.has(item.id)) {
          console.log(`   - item ${item.id.padEnd(8)} (skipped — not reached)`);
        }
      }
      console.log(`   Score: ${score}/${csvItems.length} | Budget: ${budget.getState().spentPp.toFixed(4)} PP | Status: ${iteration.status.toUpperCase()}`);

      if (score > session.bestScore) {
        session.bestScore = score;
        session.bestCandidateId = activeCandidate.id;
        await this.deps.stateManager.saveBestPrompt({
          candidateId: activeCandidate.id,
          prompt: activeCandidate.staticPrefix,
          score
        });
      }

      if (iteration.status === "success") {
        await this.deps.trace.logStep(runId, "prompt.refine.skipped_success", {
          iteration: i,
          reason: "Iteration already succeeded; no refinement needed.",
          candidateId: activeCandidate.id
        });
        const flag = iteration.results.find((result) => result.verify.flag)?.verify.flag;
        console.log(`\n✓ All items correct!${flag ? ` Flag: ${flag}` : ""}`);
        session.status = "success";
        await this.deps.stateManager.saveSession(session);
        await this.deps.stateManager.saveBudget(budget.getState());
        if (flag) {
          await this.deps.stateManager.saveFlag(flag, {
            runId,
            iteration: i,
            prompt: activeCandidate.staticPrefix
          });
          console.log(`   Saved to state/flag.json`);
          // Share winning artefacts with other agents via outbox.
          await this.deps.stateManager.saveToOutbox({
            flag,
            prompt: activeCandidate.staticPrefix,
            runId,
            iteration: i
          });
        }
        await this.deps.trace.logTrace("run.completed", {
          runId,
          iteration: i,
          score,
          flag
        });
        await this.deps.trace.logStep(runId, "run.completed", {
          iteration: i,
          score,
          flag,
          candidateId: activeCandidate.id,
          spentPp: budget.getState().spentPp
        });
        await this.deps.trace.finishRun(runId, {
          status: "success",
          finalIteration: i,
          score,
          flag,
          bestScore: session.bestScore,
          bestCandidateId: session.bestCandidateId,
          budget: budget.getState()
        });
        return;
      }

      const hypothesis = inferHypothesis(iteration);
      console.log(`   Hypothesis: ${hypothesis}`);
      if (i < this.deps.config.maxIterations) {
        await this.deps.trace.logStep(runId, "prompt.refine.requested", {
          iteration: i,
          fromCandidateId: activeCandidate.id,
          hypothesis
        });
        activeCandidate = await this.promptEngineer.refine(activeCandidate, iteration, `auto_${i + 1}`, runId);
        await this.deps.trace.logStep(runId, "prompt.refine.completed", {
          iteration: i,
          toCandidateId: activeCandidate.id,
          newPrefix: activeCandidate.staticPrefix
        });
      } else {
        await this.deps.trace.logStep(runId, "prompt.refine.skipped_final_iteration", {
          iteration: i,
          reason: "Reached MAX_ITERATIONS; no next iteration available.",
          hypothesis,
          candidateId: activeCandidate.id
        });
      }
      await this.deps.trace.logTrace("prompt.refined", {
        runId,
        iteration: i,
        hypothesis,
        from: iteration.candidateId,
        to: activeCandidate.id,
        newPrefix: activeCandidate.staticPrefix
      });

      await this.deps.stateManager.saveBudget(budget.getState());
      if (budget.isExceeded()) {
        session.status = "failed";
        await this.deps.trace.logTrace("run.stopped_budget_exceeded", {
          runId,
          spent: budget.getState().spentPp
        });
        await this.deps.trace.logStep(runId, "run.stopped_budget_exceeded", {
          iteration: i,
          spentPp: budget.getState().spentPp
        });
        break;
      }
    }

    session.status = "failed";
    await this.deps.stateManager.saveSession(session);
    await this.deps.stateManager.saveBudget(budget.getState());
    await this.deps.trace.logStep(runId, "run.failed", {
      finalIteration: session.currentIteration,
      bestScore: session.bestScore,
      bestCandidateId: session.bestCandidateId,
      budget: budget.getState()
    });
    await this.deps.trace.finishRun(runId, {
      status: "failed",
      finalIteration: session.currentIteration,
      bestScore: session.bestScore,
      bestCandidateId: session.bestCandidateId,
      budget: budget.getState()
    });
  }

  private async runIteration(
    runId: string,
    iterationNumber: number,
    items: CsvItem[],
    candidate: PromptCandidate,
    budget: BudgetManager
  ): Promise<ExperimentIteration> {
    const iteration: ExperimentIteration = {
      id: `it_${iterationNumber}_${Date.now()}`,
      mode: this.deps.config.mode,
      startedAt: new Date().toISOString(),
      candidateId: candidate.id,
      promptPrefix: candidate.staticPrefix,
      results: [],
      status: "running"
    };

    // [prompt.md] "Planowanie i monitorowanie postępów"
    // Inicjalizacja listy TODO — wszystkie 10 itemów startuje jako "pending".
    // Status jest aktualizowany na bieżąco podczas pętli przetwarzania.
    // Po zakończeniu iteracji pełna lista trafia do trace.jsonl dla debugowania.
    const todo: ItemTask[] = items.map((item) => ({
      id: item.id,
      description: item.description,
      status: "pending"
    }));

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const task = todo[idx];

      const rendered = renderPrompt(candidate, item);
      const estimate = this.tokenEstimator.estimate(rendered.fullPrompt, this.deps.config.tokenLimit);
      await this.deps.trace.logStep(runId, "prompt.generated", {
        iteration: iterationNumber,
        itemId: item.id,
        itemDescription: item.description,
        candidateId: candidate.id,
        fullPrompt: rendered.fullPrompt,
        staticPrefix: rendered.staticPrefix,
        dynamicSuffix: rendered.dynamicSuffix,
        tokenEstimate: estimate
      });
      if (!estimate.withinLimit) {
        task.status = "rejected";
        task.normalized = "INVALID";
        iteration.results.push({
          item,
          prompt: rendered.fullPrompt,
          tokenEstimate: estimate,
          verify: { rawResponse: "", normalized: "INVALID", error: "Prompt exceeds token limit." },
          expected: expectedLocalLabel(item)
        });
        iteration.status = "failed";
        iteration.hubError = "Prompt exceeded token limit";
        await this.deps.trace.logStep(runId, "prompt.rejected_token_limit", {
          iteration: iterationNumber,
          itemId: item.id,
          tokenEstimate: estimate,
          tokenLimit: this.deps.config.tokenLimit
        });
        for (let j = idx + 1; j < todo.length; j++) todo[j].status = "skipped";
        break;
      }

      if (!budget.hasBudgetForEstimated(estimate.tokens, 1, Math.max(estimate.tokens - 12, 0))) {
        task.status = "skipped";
        iteration.status = "failed";
        iteration.hubError = "Budget guard blocked request before send.";
        await this.deps.trace.logStep(runId, "request.blocked_budget_guard", {
          iteration: iterationNumber,
          itemId: item.id,
          tokenEstimate: estimate,
          budgetState: budget.getState()
        });
        for (let j = idx + 1; j < todo.length; j++) todo[j].status = "skipped";
        break;
      }

      await this.deps.trace.logStep(runId, "verify.request", {
        iteration: iterationNumber,
        itemId: item.id,
        request: {
          task: "categorize",
          answer: { prompt: rendered.fullPrompt }
        }
      });
      const verify = await this.hubClient.verifyPrompt(rendered.fullPrompt);
      await this.deps.trace.logStep(runId, "verify.response", {
        iteration: iterationNumber,
        itemId: item.id,
        response: verify
      });

      budget.recordRequest(estimate.tokens, 1, Math.max(estimate.tokens - 12, 0));
      await this.deps.trace.logStep(runId, "budget.recorded_request", {
        iteration: iterationNumber,
        itemId: item.id,
        estimatedInputTokens: estimate.tokens,
        estimatedOutputTokens: 1,
        estimatedCachedInputTokens: Math.max(estimate.tokens - 12, 0),
        budgetState: budget.getState()
      });

      const result = {
        item,
        prompt: rendered.fullPrompt,
        tokenEstimate: estimate,
        verify,
        expected: expectedLocalLabel(item)
      };
      iteration.results.push(result);

      if (verify.normalized === "INVALID") {
        task.status = "rejected";
        task.normalized = "INVALID";
        iteration.status = "failed";
        iteration.hubError = verify.error ?? "INVALID response (could not parse DNG/NEU).";
        await this.deps.trace.logStep(runId, "verify.invalid_output", {
          iteration: iterationNumber,
          itemId: item.id,
          verify,
          expected: result.expected
        });
        for (let j = idx + 1; j < todo.length; j++) todo[j].status = "skipped";
        break;
      }

      if (verify.error !== undefined) {
        // Hub explicitly rejected our classification — it is the oracle.
        task.status = "rejected";
        task.normalized = verify.normalized;
        iteration.status = "failed";
        iteration.hubError = verify.error;
        await this.deps.trace.logStep(runId, "verify.rejected_by_hub", {
          iteration: iterationNumber,
          itemId: item.id,
          verify,
          expected: result.expected
        });
        for (let j = idx + 1; j < todo.length; j++) todo[j].status = "skipped";
        break;
      }

      task.status = "accepted";
      task.normalized = verify.normalized;

      if (verify.flag) {
        iteration.status = "success";
        await this.deps.trace.logStep(runId, "verify.flag_received", {
          iteration: iterationNumber,
          itemId: item.id,
          flag: verify.flag
        });
        break;
      }
    }

    if (iteration.status === "running") {
      iteration.status = iteration.results.length === items.length ? "success" : "failed";
    }
    iteration.finishedAt = new Date().toISOString();
    iteration.hypothesisForNextRevision = inferHypothesis(iteration);

    // Log final TODO list to trace for replay/debugging.
    await this.deps.trace.logTrace("iteration.todo", {
      iterationId: iteration.id,
      todo
    });
    await this.deps.trace.logStep(runId, "iteration.completed", {
      iterationId: iteration.id,
      iteration: iterationNumber,
      status: iteration.status,
      candidateId: candidate.id,
      hubError: iteration.hubError,
      hypothesisForNextRevision: iteration.hypothesisForNextRevision,
      todo,
      results: iteration.results
    });

    if (iteration.status === "failed") {
      await this.deps.trace.logStep(runId, "hub.reset.request", {
        iteration: iterationNumber,
        iterationId: iteration.id
      });
      const resetResponse = await this.hubClient.reset();
      budget.recordReset(1, 1);
      await this.deps.trace.logStep(runId, "hub.reset.response", {
        iteration: iterationNumber,
        iterationId: iteration.id,
        response: resetResponse,
        budgetState: budget.getState()
      });
      await this.deps.trace.logTrace("hub.reset", {
        iterationId: iteration.id,
        rawResponse: resetResponse.rawResponse
      });
    }

    return iteration;
  }

  private async loadItems(): Promise<CsvItem[]> {
    return this.hubClient.fetchFreshCsv();
  }
}

import type { BudgetState } from "./types.js";

const INPUT_PER_10_COST = 0.02;
const CACHED_INPUT_PER_10_COST = 0.01;
const OUTPUT_PER_10_COST = 0.02;

const zeroBudget: BudgetState = {
  spentPp: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  requests: 0,
  resets: 0
};

export class BudgetManager {
  private readonly limitPp: number;
  private state: BudgetState;

  constructor(limitPp: number, initial?: BudgetState) {
    this.limitPp = limitPp;
    this.state = initial ? { ...initial } : { ...zeroBudget };
  }

  recordRequest(inputTokens: number, outputTokens: number, cachedInputTokens = 0): BudgetState {
    this.state.requests += 1;
    this.applyTokenCounters(inputTokens, outputTokens, cachedInputTokens);
    this.state.spentPp += this.estimateCost(inputTokens, outputTokens, cachedInputTokens);
    return this.state;
  }

  recordRequestUsingHub(
    usage: {
      tokens?: number;
      cachedTokens?: number;
      inputCostPp?: number;
      outputCostPp?: number;
    } | undefined,
    fallback: { inputTokens: number; outputTokens: number; cachedInputTokens: number }
  ): BudgetState {
    const inputTokens = usage?.tokens ?? fallback.inputTokens;
    const cachedInputTokens = usage?.cachedTokens ?? fallback.cachedInputTokens;
    const outputTokens = fallback.outputTokens;

    this.state.inputTokens += inputTokens;
    this.state.outputTokens += outputTokens;
    this.state.cachedInputTokens += cachedInputTokens;
    this.state.requests += 1;

    const hasHubCosts = usage?.inputCostPp !== undefined || usage?.outputCostPp !== undefined;
    if (hasHubCosts) {
      const estimatedInputCost = this.estimateCost(inputTokens, 0, cachedInputTokens);
      const estimatedOutputCost = this.estimateCost(0, outputTokens, 0);
      this.state.spentPp += (usage?.inputCostPp ?? estimatedInputCost) + (usage?.outputCostPp ?? estimatedOutputCost);
      return this.state;
    }

    this.state.spentPp += this.estimateCost(inputTokens, outputTokens, cachedInputTokens);
    return this.state;
  }

  recordReset(
    inputTokens = 1,
    outputTokens = 1,
    usage?: {
      tokens?: number;
      cachedTokens?: number;
      inputCostPp?: number;
      outputCostPp?: number;
    }
  ): BudgetState {
    this.state.resets += 1;
    return this.recordRequestUsingHub(usage, { inputTokens, outputTokens, cachedInputTokens: 0 });
  }

  resetBudgetWindow(): BudgetState {
    this.state.spentPp = 0;
    this.state.inputTokens = 0;
    this.state.cachedInputTokens = 0;
    this.state.outputTokens = 0;
    this.state.requests = 0;
    return this.getState();
  }

  getState(): BudgetState {
    return { ...this.state };
  }

  hasBudgetForEstimated(inputTokens: number, outputTokens: number, cachedInputTokens = 0): boolean {
    const delta = this.estimateCost(inputTokens, outputTokens, cachedInputTokens);
    return this.state.spentPp + delta <= this.limitPp;
  }

  isExceeded(): boolean {
    return this.state.spentPp > this.limitPp;
  }

  private applyTokenCounters(inputTokens: number, outputTokens: number, cachedInputTokens: number): void {
    this.state.inputTokens += inputTokens;
    this.state.outputTokens += outputTokens;
    this.state.cachedInputTokens += cachedInputTokens;
  }

  private estimateCost(inputTokens: number, outputTokens: number, cachedInputTokens: number): number {
    // cachedInputTokens is a subset of inputTokens.
    return (
      ((inputTokens - cachedInputTokens) / 10) * INPUT_PER_10_COST +
      (cachedInputTokens / 10) * CACHED_INPUT_PER_10_COST +
      (outputTokens / 10) * OUTPUT_PER_10_COST
    );
  }
}

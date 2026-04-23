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
    this.state.inputTokens += inputTokens;
    this.state.outputTokens += outputTokens;
    this.state.cachedInputTokens += cachedInputTokens;
    this.state.requests += 1;
    // cachedInputTokens is a subset of inputTokens (cache hits charged at reduced rate).
    // Non-cached portion = inputTokens - cachedInputTokens, charged at full rate.
    this.state.spentPp +=
      ((inputTokens - cachedInputTokens) / 10) * INPUT_PER_10_COST +
      (cachedInputTokens / 10) * CACHED_INPUT_PER_10_COST +
      (outputTokens / 10) * OUTPUT_PER_10_COST;
    return this.state;
  }

  recordReset(inputTokens = 1, outputTokens = 1): BudgetState {
    this.state.resets += 1;
    return this.recordRequest(inputTokens, outputTokens, 0);
  }

  getState(): BudgetState {
    return { ...this.state };
  }

  hasBudgetForEstimated(inputTokens: number, outputTokens: number, cachedInputTokens = 0): boolean {
    // cachedInputTokens is a subset of inputTokens — same split as in recordRequest.
    const delta =
      ((inputTokens - cachedInputTokens) / 10) * INPUT_PER_10_COST +
      (cachedInputTokens / 10) * CACHED_INPUT_PER_10_COST +
      (outputTokens / 10) * OUTPUT_PER_10_COST;
    return this.state.spentPp + delta <= this.limitPp;
  }

  isExceeded(): boolean {
    return this.state.spentPp > this.limitPp;
  }
}

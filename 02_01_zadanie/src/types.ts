export type Mode = "SAFE_LOCAL" | "REMOTE_EXPERIMENT";

export type Label = "DNG" | "NEU";

export interface CsvItem {
  id: string;
  description: string;
  raw: Record<string, string>;
}

export interface PromptCandidate {
  id: string;
  staticPrefix: string;
  dynamicSuffixTemplate: string;
  rationale: string;
}

export interface PromptRender {
  fullPrompt: string;
  staticPrefix: string;
  dynamicSuffix: string;
}

export interface TokenEstimate {
  tokens: number;
  withinLimit: boolean;
  limit: number;
}

export interface BudgetState {
  spentPp: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  requests: number;
  resets: number;
}

export interface VerifyResult {
  rawResponse: string;
  normalized: Label | "INVALID";
  isCorrect?: boolean;
  flag?: string;
  error?: string;
}

export interface ItemRunResult {
  item: CsvItem;
  prompt: string;
  tokenEstimate: TokenEstimate;
  verify: VerifyResult;
  expected?: Label;
}

export interface ExperimentIteration {
  id: string;
  mode: Mode;
  startedAt: string;
  finishedAt?: string;
  candidateId: string;
  promptPrefix: string;
  results: ItemRunResult[];
  status: "running" | "failed" | "success";
  hypothesisForNextRevision?: string;
  hubError?: string;
}

export interface SessionState {
  runId: string;
  mode: Mode;
  startedAt: string;
  currentIteration: number;
  bestCandidateId?: string;
  bestScore: number;
  status: "running" | "success" | "failed";
}

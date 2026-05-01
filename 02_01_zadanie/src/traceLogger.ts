import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface RunTraceStep {
  at: string;
  step: string;
  payload: unknown;
}

interface RunTraceDocument {
  runId: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  meta?: unknown;
  summary?: unknown;
  steps: RunTraceStep[];
}

export class TraceLogger {
  private readonly tracePath: string;
  private readonly experimentPath: string;
  private readonly runTraceDir: string;
  private readonly runTraces = new Map<string, RunTraceDocument>();

  constructor(stateDir: string) {
    this.tracePath = resolve(stateDir, "trace.jsonl");
    this.experimentPath = resolve(stateDir, "experiments.jsonl");
    this.runTraceDir = resolve(stateDir, "runs");
  }

  async logTrace(event: string, payload: unknown): Promise<void> {
    await this.appendLine(this.tracePath, {
      at: new Date().toISOString(),
      event,
      payload
    });
  }

  async logExperiment(payload: unknown): Promise<void> {
    await this.appendLine(this.experimentPath, {
      at: new Date().toISOString(),
      ...((payload as Record<string, unknown>) ?? {})
    });
  }

  async startRun(runId: string, meta?: unknown): Promise<void> {
    const now = new Date().toISOString();
    const doc: RunTraceDocument = {
      runId,
      startedAt: now,
      updatedAt: now,
      meta,
      steps: []
    };
    this.runTraces.set(runId, doc);
    await this.writeRunTrace(doc);
  }

  async logStep(runId: string, step: string, payload: unknown): Promise<void> {
    const existing = this.runTraces.get(runId);
    const now = new Date().toISOString();
    const doc: RunTraceDocument = existing ?? {
      runId,
      startedAt: now,
      updatedAt: now,
      steps: []
    };
    doc.steps.push({
      at: now,
      step,
      payload
    });
    doc.updatedAt = now;
    this.runTraces.set(runId, doc);
    await this.writeRunTrace(doc);
  }

  async finishRun(runId: string, summary?: unknown): Promise<void> {
    const existing = this.runTraces.get(runId);
    const now = new Date().toISOString();
    const doc: RunTraceDocument = existing ?? {
      runId,
      startedAt: now,
      updatedAt: now,
      steps: []
    };
    doc.summary = summary;
    doc.finishedAt = now;
    doc.updatedAt = now;
    this.runTraces.set(runId, doc);
    await this.writeRunTrace(doc);
  }

  private async appendLine(path: string, line: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(line)}\n`, "utf-8");
  }

  private async writeRunTrace(doc: RunTraceDocument): Promise<void> {
    const filePath = resolve(this.runTraceDir, `trace_${doc.runId}.json`);
    await mkdir(dirname(filePath), { recursive: true });
    // Keep as one pretty JSON file for easier post-run inspection.
    await writeFile(filePath, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  }
}

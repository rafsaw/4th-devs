import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class TraceLogger {
  private readonly tracePath: string;
  private readonly experimentPath: string;

  constructor(stateDir: string) {
    this.tracePath = resolve(stateDir, "trace.jsonl");
    this.experimentPath = resolve(stateDir, "experiments.jsonl");
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

  private async appendLine(path: string, line: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(line)}\n`, "utf-8");
  }
}

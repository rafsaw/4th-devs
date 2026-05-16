const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export function sanitizeNote(note: string): string {
  return note
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/"/g, "'")
    .replace(/\\/g, " ")
    .trim();
}

export async function findErrorIndicesViaOpenRouter(
  notesList: string[],
  apiKey: string,
  model: string,
): Promise<{ indices: number[]; usage: OpenRouterUsage; elapsedMs: number }> {
  const cleanNotes = notesList.map(sanitizeNote);
  const numbered = cleanNotes
    .map((note, i) => `${i + 1}. ${note}`)
    .join("\n");

  const prompt =
    "You are reviewing operator notes from a nuclear power plant sensor system.\n" +
    "Some notes indicate a PROBLEM (anomaly, fault, error, instability, malfunction, " +
    "something off, erratic readings, irregularity, opened a ticket, etc.).\n" +
    "Other notes say everything is NORMAL (stable, fine, within range, nominal, etc.).\n\n" +
    "Return a JSON array of LINE NUMBERS (1-based) for notes that indicate a PROBLEM. " +
    "Return [] if all notes are normal. No explanation.\n\n" +
    `Notes:\n${numbered}\n\n` +
    "JSON array of problem line numbers:";

  const tStart = Date.now();

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const body = (await res.json()) as Record<string, unknown>;
  const elapsedMs = Date.now() - tStart;

  if (!res.ok) {
    const err = typeof body.error === "object" ? JSON.stringify(body.error) : String(body);
    throw new Error(`OpenRouter HTTP ${res.status}: ${err}`);
  }

  const usage =
    typeof body.usage === "object" && body.usage !== null
      ? (body.usage as OpenRouterUsage)
      : {};

  const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = String(choices?.[0]?.message?.content ?? "").trim();

  const match = text.match(/\[.*?]/s);
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        const indices = parsed
          .filter((x) => typeof x === "number")
          .map((x) => Math.trunc(Number(x)))
          .filter((idx) => idx >= 1 && idx <= notesList.length);
        return { indices, usage, elapsedMs };
      }
    } catch {
      // fall through
    }
  }

  console.warn(`  ⚠  LLM zwrócił nieoczekiwany format: ${text.slice(0, 150)}`);
  return { indices: [], usage, elapsedMs };
}

export async function findAllErrorNotes(
  noteToIds: Map<string, string[]>,
  apiKey: string,
  model: string,
  batchSize = 200,
  onBatchStats?: (
    promptIn: number,
    completionOut: number,
    elapsedMs: number,
  ) => void,
): Promise<Set<string>> {
  const uniqueNotes = [...noteToIds.keys()];
  const errorFileIds = new Set<string>();

  for (let start = 0; start < uniqueNotes.length; start += batchSize) {
    const batch = uniqueNotes.slice(start, start + batchSize);
    const end = start + batch.length;
    console.log(
      `  🤖 LLM: notatki ${start + 1}–${end} / ${uniqueNotes.length} ...`,
    );

    const { indices, usage, elapsedMs } = await findErrorIndicesViaOpenRouter(
      batch,
      apiKey,
      model,
    );

    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    onBatchStats?.(promptTokens, completionTokens, elapsedMs);

    console.log(
      `  [Batch tokens] in=${promptTokens}, out=${completionTokens}  [${elapsedMs} ms]`,
    );

    if (indices.length) {
      console.log(`     ERROR indices w batchu: ${indices.join(", ")}`);
      for (const idx of indices) {
        const note = batch[idx - 1];
        console.log(`     • [${idx}] ${note.slice(0, 80)}`);
        for (const id of noteToIds.get(note) ?? []) errorFileIds.add(id);
      }
    }
  }

  return errorFileIds;
}

import type { FieldId } from "./types.js";

const HUB_BASE = "https://hub.ag3nts.org";
const TASK = "electricity";

function apikey(): string {
  const key = process.env.AI_DEVS_4_KEY ?? process.env.AG3NTS_API_KEY;
  if (!key) throw new Error("Missing AI_DEVS_4_KEY / AG3NTS_API_KEY in env");
  return key;
}

export async function fetchCurrentBoardImage(): Promise<Buffer> {
  const url = `${HUB_BASE}/data/${apikey()}/electricity.png`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

export async function resetBoard(): Promise<void> {
  const url = `${HUB_BASE}/data/${apikey()}/electricity.png?reset=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET reset failed: ${res.status} ${res.statusText}`);
}

export type RotateResponse = {
  ok: boolean;
  flag?: string;
  raw: unknown;
  message: string;
};

export async function rotateField(field: FieldId): Promise<RotateResponse> {
  const url = `${HUB_BASE}/verify`;
  const body = {
    apikey: apikey(),
    task: TASK,
    answer: { rotate: field },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  // Hub may answer in a few shapes; we extract a flag if present.
  const stringified = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  const flagMatch = stringified.match(/\{FLG:[^}]+\}/);
  const flag = flagMatch ? flagMatch[0] : undefined;

  return {
    ok: res.ok,
    flag,
    raw: parsed,
    message: typeof parsed === "object" && parsed !== null && "message" in parsed
      ? String((parsed as Record<string, unknown>).message ?? "")
      : stringified,
  };
}

import fs from "node:fs/promises";
import path from "node:path";
import { AI_DEVS_4_KEY } from "./env.js";

const BASE = "https://hub.ag3nts.org";

export function boardUrl(reset: boolean): string {
  const key = AI_DEVS_4_KEY();
  return `${BASE}/data/${key}/electricity.png${reset ? "?reset=1" : ""}`;
}

export async function downloadBoard(
  destPath: string,
  reset: boolean
): Promise<void> {
  const url = boardUrl(reset);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
}

export type VerifyResponse = unknown;

export async function rotateTile(tileId: string): Promise<VerifyResponse> {
  const key = AI_DEVS_4_KEY();
  const res = await fetch(`${BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: key,
      task: "electricity",
      answer: { rotate: tileId },
    }),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`POST verify -> ${res.status}: ${text}`);
  }
  return body;
}

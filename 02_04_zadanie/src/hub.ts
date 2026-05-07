import { config } from "./config.js";

export interface Answer {
  date?: string;
  password?: string;
  confirmation_code?: string;
}

export interface VerifyResult {
  raw: unknown;
  text: string;
  flag: string | null;
}

const FLAG_REGEX = /\{\{?FLG:[^}]+\}\}?/;

export async function verify(answer: Answer): Promise<VerifyResult> {
  const body = {
    apikey: config.apikey,
    task: "mailbox",
    answer,
  };
  const res = await fetch(config.hubVerifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    /* ignore */
  }
  const flag = text.match(FLAG_REGEX)?.[0] ?? null;
  return { raw, text, flag };
}

import { config } from "./config.js";

export interface ZmailMessageMeta {
  id: string | number;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  [key: string]: unknown;
}

async function call(action: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  const body = { apikey: config.apikey, action, ...extra };
  const res = await fetch(config.zmailUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`zmail ${action} failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function zmailHelp(page = 1) {
  return call("help", { page });
}

export function zmailGetInbox(page = 1, perPage = 20) {
  return call("getInbox", { page, perPage });
}

export function zmailSearch(query: string, page = 1, perPage = 20) {
  return call("search", { query, page, perPage });
}

export function zmailGetThread(threadID: string | number) {
  return call("getThread", { threadID });
}

export function zmailGetMessages(ids: Array<string | number> | string | number) {
  return call("getMessages", { ids: Array.isArray(ids) ? ids : [ids] });
}

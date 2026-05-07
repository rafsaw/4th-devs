import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  apikey: required("AG3NTS_API_KEY"),
  openrouterKey: required("OPENROUTER_API_KEY"),
  zmailUrl: process.env.ZMAIL_URL ?? "https://hub.ag3nts.org/api/zmail",
  hubVerifyUrl: process.env.HUB_VERIFY_URL ?? "https://hub.ag3nts.org/verify",
  model: process.env.MODEL ?? "google/gemini-3-flash-preview",
  maxIter: Number(process.env.MAX_ITER ?? "30"),
};

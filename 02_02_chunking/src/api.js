import { AI_API_KEY, RESPONSES_API_ENDPOINT, EXTRA_API_HEADERS, resolveModelForProvider } from "../../config.js";

const DEFAULT_MODEL = resolveModelForProvider("gpt-4.1-mini");
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getErrorCode = (error) =>
  error?.cause?.code ?? error?.code ?? "";

const isTransientNetworkError = (error) =>
  typeof getErrorCode(error) === "string" &&
  getErrorCode(error).startsWith("UND_ERR");

const isRetryableStatus = (status) => status === 429 || status >= 500;

const isAbortOrTimeout = (error) =>
  error?.name === "AbortError"
  || getErrorCode(error) === 23
  || /aborted due to timeout|timeout/i.test(error?.message ?? "");

export const chat = async (
  input,
  instructions,
  model = DEFAULT_MODEL,
  { timeoutMs = REQUEST_TIMEOUT_MS } = {},
) => {
  const body = { model, input };
  if (instructions) body.instructions = instructions;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(RESPONSES_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
          ...EXTRA_API_HEADERS
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = data?.error?.message ?? `Request failed with status ${res.status}`;
        const error = new Error(message);
        error.status = res.status;
        throw error;
      }

      if (data.error) throw new Error(data.error.message);

      const message = data.output?.find((item) => item.type === "message");
      return message?.content?.[0]?.text ?? "";
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const shouldRetry =
        isTransientNetworkError(error)
        || isRetryableStatus(error?.status)
        || isAbortOrTimeout(error);

      if (!shouldRetry || isLastAttempt) {
        const code = getErrorCode(error);
        const prefix = code ? `[${code}] ` : "";
        throw new Error(`chat() failed after ${attempt} attempt(s): ${prefix}${error.message}`);
      }

      const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
};

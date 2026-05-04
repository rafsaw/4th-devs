/**
 * Topic-based (AI-driven) chunking
 * Uses the LLM to identify logical topic boundaries and returns chunks per topic.
 */

import { chat } from "../api.js";
import { buildHeadingIndex, findSection } from "../utils.js";

/** One call returns the full document split as JSON — large payloads need more than default client timeout. */
const TOPICS_CHAT_TIMEOUT_MS = 180_000;

export const chunkByTopics = async (text, { source } = {}) => {
  const raw = await chat(
    text,
    `You are a document chunking expert. Break the provided document into logical topic-based chunks.

Rules:
- Each chunk must contain ONE coherent topic or idea
- Preserve the original text exactly — do NOT summarise, rewrite, or translate
- Keep the SAME language as the input text for both "topic" and "content"
- The "topic" must be a short label (2-6 words) in the SAME language as the input
- Do NOT mix languages

Output format:
- Return a JSON array of objects:
  [{ "topic": "short topic label", "content": "original text for this topic" }]

Output rules:
- Return ONLY the JSON array
- No markdown fences, no explanations, no extra text`,
    undefined,
    { timeoutMs: TOPICS_CHAT_TIMEOUT_MS },
  );

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const headings = buildHeadingIndex(text);

  return parsed.map((item, i) => ({
    content: item.content,
    metadata: {
      strategy: "topics",
      index: i,
      topic: item.topic,
      chars: item.content.length,
      section: findSection(text, item.content, headings),
      source: source ?? null,
    },
  }));
};

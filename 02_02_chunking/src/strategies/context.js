/**
 * Context-enriched chunking (Anthropic-style contextual retrieval)
 * Splits with separators first, then uses LLM to generate a context prefix per chunk.
 */

import { chat } from "../api.js";
import { chunkBySeparators } from "./separators.js";

const enrichChunk = async (chunk) => {
  const context = await chat(
    `<chunk>${chunk.content}</chunk>`,
    `Generate a concise (1-2 sentence) context that situates this chunk within the overall document.

IMPORTANT:
- Detect the language of the input text.
- The output MUST be in the SAME language as the input text.
- If the input is Polish, the output must be Polish.
- Do NOT translate or mix languages.

OUTPUT RULES:
- Return ONLY the context.
- No explanations, no labels, no extra text.`
  );
  return {
    content: chunk.content,
    metadata: { ...chunk.metadata, strategy: "context", context },
  };
};

export const chunkWithContext = async (text, opts = {}) => {
  const base = chunkBySeparators(text, opts);
  const enriched = [];

  for (const [i, chunk] of base.entries()) {
    process.stdout.write(`  context: enriching ${i + 1}/${base.length}\r`);
    enriched.push(await enrichChunk(chunk));
  }
  console.log();

  return enriched;
};

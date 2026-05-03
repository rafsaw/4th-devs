import OpenAI from "openai";
import { z } from "zod";
import type { BoardState, FieldId, Tile } from "./types.js";
import { ALL_FIELDS } from "./types.js";

export const VISION_MODEL =
  process.env.VISION_MODEL ?? "google/gemini-3-flash-preview";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY in env");
  _client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "https://localhost",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "4th-devs-02-02-electricity",
    },
  });
  return _client;
}

const TileSchema = z.object({
  top: z.boolean(),
  right: z.boolean(),
  bottom: z.boolean(),
  left: z.boolean(),
  special: z.enum(["source", "plant", "empty", "pipe"]),
  label: z.string().optional(),
});

const SYSTEM_PROMPT = `Jesteś klasyfikatorem pojedynczej komórki puzzla elektrycznego.
Otrzymujesz wycinek (jeden z 9 kafelków planszy 3x3) przedstawiający fragment kabla.
Twoim zadaniem jest określić, przez które krawędzie kafelka kabel wychodzi na zewnątrz.

Każdą krawędź klasyfikujesz osobno:
- top    : czy kabel dotyka górnej krawędzi kafelka?
- right  : czy kabel dotyka prawej krawędzi kafelka?
- bottom : czy kabel dotyka dolnej krawędzi kafelka?
- left   : czy kabel dotyka lewej krawędzi kafelka?

Dodatkowo wskaż special:
- "source" - kafelek zawiera ikonę źródła (lewy-dolny róg planszy może być oznaczony, ale tu klasyfikujesz na podstawie wyglądu)
- "plant"  - kafelek zawiera label/etykietę elektrowni (PWR...)
- "pipe"   - zwykły fragment kabla (najczęstszy przypadek)
- "empty"  - brak kabla

Zwróć WYŁĄCZNIE poprawny JSON o schemacie:
{ "top": bool, "right": bool, "bottom": bool, "left": bool, "special": "source"|"plant"|"empty"|"pipe", "label"?: string }
Bez komentarzy, bez markdown, bez backticków.`;

const USER_PROMPT = `Sklasyfikuj ten kafelek. Zwróć JSON wg schematu z system prompta.`;

/**
 * Classify a single tile image. Calls vision LLM and validates the JSON.
 * Retries up to 2x on parse failures with a more strict reminder.
 */
export async function classifyTile(
  pngBuffer: Buffer,
  fieldHint?: FieldId,
): Promise<Tile> {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  const client = getClient();

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const userText = fieldHint
      ? `${USER_PROMPT}\n(podpowiedź: pole ${fieldHint})`
      : USER_PROMPT;
    const completion = await client.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    const content = completion.choices[0]?.message?.content ?? "";
    try {
      const cleaned = content
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "");
      const parsed = JSON.parse(cleaned);
      const tile = TileSchema.parse(parsed);
      return tile;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Vision classification failed after retries for ${fieldHint ?? "tile"}: ${String(lastErr)}`,
  );
}

/**
 * Classify all 9 tiles concurrently. Returns a fully populated BoardState.
 */
export async function classifyBoard(
  tiles: Record<FieldId, Buffer>,
): Promise<BoardState> {
  const entries = await Promise.all(
    ALL_FIELDS.map(async (fid) => {
      const tile = await classifyTile(tiles[fid], fid);
      return [fid, tile] as const;
    }),
  );
  const board = {} as BoardState;
  for (const [fid, tile] of entries) board[fid] = tile;
  return board;
}

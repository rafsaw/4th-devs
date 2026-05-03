import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  fetchCurrentBoardImage,
  resetBoard,
  rotateField,
} from "./hub.js";
import { debugDumpTiles, hashBuffer, splitInto9Tiles } from "./tiles.js";
import { classifyBoard } from "./vision.js";
import {
  compactBoard,
  computeDiff,
  renderBoard,
  renderDiff,
} from "./visualize.js";
import type { BoardState, FieldId } from "./types.js";
import { ALL_FIELDS } from "./types.js";

const AGENT_MODEL = process.env.AGENT_MODEL ?? "google/gemini-3-flash-preview";

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

// ============================================================================
// Caches
// ============================================================================

type BoardCacheEntry = { hash: string; board: BoardState };
let _currentBoardCache: BoardCacheEntry | null = null;
let _targetBoardCache: BoardCacheEntry | null = null;

const SOLVED_PATH =
  process.env.SOLVED_PATH ??
  path.resolve(process.cwd(), "solved_electricity.png");

const FLAG_PATH =
  process.env.FLAG_PATH ?? path.resolve(process.cwd(), "flag.txt");

async function persistFlag(flag: string, source: string): Promise<void> {
  const ts = new Date().toISOString();
  const line = `[${ts}] (${source}) ${flag}\n`;
  await fs.appendFile(FLAG_PATH, line, "utf8");
  console.log(`💾 zapisano flagę do ${FLAG_PATH}`);
}

const BOARDS_DIR =
  process.env.BOARDS_DIR ?? path.resolve(process.cwd(), ".cache/boards");

/**
 * Persist a board PNG snapshot for later inspection. Filename includes
 * a sortable timestamp (so the sequence of fetches is preserved) and the
 * content hash (so duplicate fetches are obvious by identical suffix).
 */
async function persistBoardImage(
  buf: Buffer,
  kind: "current" | "target",
  hash: string,
): Promise<string> {
  await fs.mkdir(BOARDS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${kind}_${ts}_${hash}.png`;
  const full = path.join(BOARDS_DIR, filename);
  await fs.writeFile(full, buf);
  return full;
}

// ============================================================================
// Tool implementations (called by agent through function-calling)
// ============================================================================

async function tool_read_current_board(): Promise<{
  board: BoardState;
  cached: boolean;
  hash: string;
  ascii: string;
}> {
  console.log("\n[tool] read_current_board → pobieram electricity.png z huba…");
  const buf = await fetchCurrentBoardImage();
  const hash = hashBuffer(buf);
  const saved = await persistBoardImage(buf, "current", hash);
  console.log(`📸 zapisano obraz: ${saved}`);

  if (_currentBoardCache && _currentBoardCache.hash === hash) {
    const ascii = renderBoard(_currentBoardCache.board, "STAN BIEŻĄCY (z cache)");
    console.log(ascii);
    return { board: _currentBoardCache.board, cached: true, hash, ascii };
  }

  const { tiles } = await splitInto9Tiles(buf);
  if (process.env.DEBUG_TILES_DIR) {
    await debugDumpTiles(tiles, process.env.DEBUG_TILES_DIR, "current");
  }
  console.log("[tool] read_current_board → klasyfikuję 9 kafelków przez vision (równolegle)…");
  const board = await classifyBoard(tiles);
  _currentBoardCache = { hash, board };

  const ascii = renderBoard(board, "STAN BIEŻĄCY");
  console.log(ascii);
  return { board, cached: false, hash, ascii };
}

async function tool_read_target_board(): Promise<{
  board: BoardState;
  cached: boolean;
  hash: string;
  ascii: string;
}> {
  console.log(`\n[tool] read_target_board → wczytuję ${SOLVED_PATH}…`);
  const buf = await fs.readFile(SOLVED_PATH);
  const hash = hashBuffer(buf);
  if (_targetBoardCache && _targetBoardCache.hash === hash) {
    const ascii = renderBoard(_targetBoardCache.board, "STAN DOCELOWY (z cache)");
    console.log(ascii);
    return { board: _targetBoardCache.board, cached: true, hash, ascii };
  }
  // First-time copy of target into boards dir for symmetry with current snapshots.
  const saved = await persistBoardImage(buf, "target", hash);
  console.log(`📸 skopiowano referencję: ${saved}`);

  const { tiles } = await splitInto9Tiles(buf);
  if (process.env.DEBUG_TILES_DIR) {
    await debugDumpTiles(tiles, process.env.DEBUG_TILES_DIR, "target");
  }
  console.log("[tool] read_target_board → klasyfikuję 9 kafelków przez vision (równolegle)…");
  const board = await classifyBoard(tiles);
  _targetBoardCache = { hash, board };

  const ascii = renderBoard(board, "STAN DOCELOWY");
  console.log(ascii);
  return { board, cached: false, hash, ascii };
}

async function tool_rotate_field(field: FieldId): Promise<{
  ok: boolean;
  flag?: string;
  message: string;
}> {
  if (!ALL_FIELDS.includes(field)) {
    return { ok: false, message: `Nieprawidłowe pole: ${field}` };
  }
  console.log(`[tool] rotate_field("${field}") → POST /verify`);
  const resp = await rotateField(field);
  // Invalidate current board cache because state changed.
  _currentBoardCache = null;
  if (resp.flag) {
    console.log(`✓ ${field}: ${resp.message} ⟶  FLAGA: ${resp.flag}`);
    await persistFlag(resp.flag, `rotate_field(${field})`);
  } else {
    console.log(`✓ ${field}: ${resp.ok ? "ok" : "FAIL"} ${resp.message}`);
  }
  return { ok: resp.ok, flag: resp.flag, message: resp.message };
}

async function tool_reset_board(): Promise<{ ok: boolean; message: string }> {
  console.log("[tool] reset_board → GET ?reset=1");
  await resetBoard();
  _currentBoardCache = null;
  return { ok: true, message: "Plansza zresetowana." };
}

async function tool_compute_plan(): Promise<{
  plan: { field: FieldId; rotations: number }[];
  totalRotations: number;
  diffText: string;
  matches: boolean;
}> {
  console.log("\n[tool] compute_plan → liczę różnicę current vs target…");
  // Always re-read current; target may use cache.
  const cur = await tool_read_current_board();
  const tgt = await tool_read_target_board();
  const diff = computeDiff(cur.board, tgt.board);
  const plan = diff
    .filter((d) => d.rotations !== null && d.rotations > 0)
    .map((d) => ({ field: d.field, rotations: d.rotations as number }));
  const total = plan.reduce((s, p) => s + p.rotations, 0);
  const diffText = renderDiff(diff);
  const matches = diff.every((d) => d.matches);

  console.log("\n=== DIFF ===");
  console.log(diffText);
  return { plan, totalRotations: total, diffText, matches };
}

// ============================================================================
// Tool registry & dispatcher
// ============================================================================

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_current_board",
      description:
        "Pobiera świeży obraz electricity.png z huba, dzieli na 9 kafelków, " +
        "klasyfikuje każdy przez vision LLM. Zwraca BoardState (krawędzie kabla na każdym z 9 pól) oraz ASCII-mapę.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_target_board",
      description:
        "Wczytuje lokalny plik solved_electricity.png (referencja docelowa), " +
        "dzieli na 9 kafelków i klasyfikuje vision LLM-em. Wynik zapamiętany w cache " +
        "więc kolejne wywołania nie kosztują nowych zapytań.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_plan",
      description:
        "Czyta current i target board (używając cache jeśli dostępny), liczy diff i zwraca " +
        "plan: dla każdego pola ile obrotów w prawo (0-3) potrzeba. Zwraca też matches=true gdy " +
        "stan bieżący już zgadza się z docelowym.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "rotate_field",
      description:
        "Wykonuje JEDEN obrót o 90° w prawo wskazanego pola. Każde wywołanie = 1 zapytanie do API. " +
        "Zwraca ok i ewentualnie flag jeśli plansza została właśnie ułożona poprawnie.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ALL_FIELDS,
            description: "Pole w formacie RxC (np. \"1x1\", \"2x3\")",
          },
        },
        required: ["field"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_board",
      description:
        "Resetuje planszę do stanu początkowego. Używaj TYLKO w razie błędu " +
        "(np. wykonano za dużo obrotów i trudno odtworzyć).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_done",
      description:
        "Wywołaj gdy plansza zgadza się z target i otrzymano flagę. Kończy działanie agenta. " +
        "Argumenty: flag (treść flagi otrzymanej z huba) oraz reasoning (krótkie podsumowanie).",
      parameters: {
        type: "object",
        properties: {
          flag: { type: "string", description: "Otrzymana flaga {FLG:...}" },
          reasoning: { type: "string", description: "Krótkie podsumowanie po polsku" },
        },
        required: ["flag", "reasoning"],
      },
    },
  },
];

type DispatchResult = { result: unknown; finalFlag?: string; done?: boolean };

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
): Promise<DispatchResult> {
  switch (name) {
    case "read_current_board": {
      const r = await tool_read_current_board();
      return {
        result: {
          board: r.board,
          compact: compactBoard(r.board),
          cached: r.cached,
        },
      };
    }
    case "read_target_board": {
      const r = await tool_read_target_board();
      return {
        result: {
          board: r.board,
          compact: compactBoard(r.board),
          cached: r.cached,
        },
      };
    }
    case "compute_plan": {
      const r = await tool_compute_plan();
      return {
        result: {
          plan: r.plan,
          totalRotations: r.totalRotations,
          matches: r.matches,
        },
      };
    }
    case "rotate_field": {
      const field = args.field as FieldId;
      const r = await tool_rotate_field(field);
      return { result: r, finalFlag: r.flag };
    }
    case "reset_board": {
      const r = await tool_reset_board();
      return { result: r };
    }
    case "submit_done": {
      const flag = String(args.flag ?? "");
      const reasoning = String(args.reasoning ?? "");
      console.log(`\n=== AGENT KOŃCZY ===\n${reasoning}\nFLAGA: ${flag}\n`);
      if (flag) await persistFlag(flag, "submit_done");
      return { result: { acknowledged: true }, finalFlag: flag, done: true };
    }
    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}

// ============================================================================
// Agent loop
// ============================================================================

const SYSTEM_PROMPT = `Jesteś agentem rozwiązującym puzzle elektryczne 3x3 (zadanie "electricity" z AI Devs 4).

ZASADY ZADANIA:
- Plansza to 9 pól w siatce 3x3, indeksowanych RxC (R = wiersz 1-3 od góry, C = kolumna 1-3 od lewej).
- Każde pole zawiera fragment kabla wychodzący przez kombinację 4 krawędzi (top/right/bottom/left).
- Twoim celem jest, żeby stan bieżący KAŻDEGO z 9 pól zgadzał się z polem o tej samej współrzędnej w stanie DOCELOWYM (referencja: solved_electricity.png).
- Jedyna dozwolona operacja: obrót pola o 90° W PRAWO. Każdy obrót to 1 zapytanie do API.
- Obrót w prawo = top→right→bottom→left→top.
- Żeby obrócić pole "w lewo" wykonaj 3 obroty w prawo.
- Po ułożeniu planszy hub zwróci flagę {FLG:...}.

DOSTĘPNE NARZĘDZIA:
1. read_current_board() - pobiera świeży stan z huba i klasyfikuje 9 pól (zwraca top/right/bottom/left dla każdego).
2. read_target_board() - czyta lokalną referencję solved_electricity.png (cache po pierwszym razie).
3. compute_plan() - ZALECANE NA START: czyta oba i podaje plan ile obrotów na każde pole (0-3).
4. rotate_field(field) - 1 obrót pola, np. "2x1".
5. reset_board() - tylko w razie błędu.
6. submit_done(flag, reasoning) - kończy gdy dostałeś flagę.

STRATEGIA:
1. Wywołaj compute_plan() żeby od razu zobaczyć plan.
2. Wykonaj wszystkie potrzebne rotacje przez rotate_field().
   Możesz wywoływać kilka rotate_field równolegle (w jednej turze tool_calls), ale serwer i tak je serializuje.
3. Po wszystkich rotacjach wywołaj jeszcze raz compute_plan() żeby zweryfikować.
4. Gdy któryś rotate_field zwróci flag → wywołaj submit_done(flag, krótkie podsumowanie) i kończ.

Mów po polsku. Bądź zwięzły. Działaj odważnie - klasyfikator jest dobry, ufaj mu.`;

export async function runAgent(opts: { maxIterations?: number } = {}): Promise<{
  flag?: string;
  iterations: number;
}> {
  const maxIterations = opts.maxIterations ?? 40;
  const client = getClient();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "Rozwiąż zadanie electricity. Zacznij od compute_plan(), potem wykonaj rotacje, potem zweryfikuj.",
    },
  ];

  let finalFlag: string | undefined;
  let iter = 0;
  for (iter = 0; iter < maxIterations; iter++) {
    console.log(`\n──── ITERACJA ${iter + 1} ────`);

    const completion = await client.chat.completions.create({
      model: AGENT_MODEL,
      temperature: 0.1,
      tools,
      tool_choice: "auto",
      messages,
    });

    const choice = completion.choices[0];
    const msg = choice.message;
    messages.push(msg as OpenAI.Chat.Completions.ChatCompletionMessageParam);

    if (msg.content) {
      console.log(`[agent] ${msg.content}`);
    }

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      console.log("[agent] Brak tool_calls - agent zakończył.");
      break;
    }

    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = {};
      }
      try {
        const dispatched = await dispatchTool(tc.function.name, args);
        if (dispatched.finalFlag) finalFlag = dispatched.finalFlag;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(dispatched.result),
        });
        if (dispatched.done) {
          return { flag: finalFlag, iterations: iter + 1 };
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[tool ${tc.function.name}] ERROR: ${errMsg}`);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ ok: false, error: errMsg }),
        });
      }
    }

    if (finalFlag) {
      // Give the model one more turn to call submit_done if it wants to.
      // If not, we exit ourselves.
    }
  }

  if (iter >= maxIterations) {
    console.warn(`\n[agent] OSIĄGNIĘTO MAX ITERACJI (${maxIterations})`);
  }

  return { flag: finalFlag, iterations: iter + 1 };
}

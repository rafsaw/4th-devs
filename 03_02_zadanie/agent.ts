import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AG3NTS_API_KEY = process.env.AG3NTS_API_KEY ?? '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? '';

const SHELL_API_URL = 'https://hub.ag3nts.org/api/shell';
const CENTRALA_URL = 'https://centrala.ag3nts.org/report';
const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const MAX_ITERATIONS = 80;
const MAX_TOOL_OUTPUT_CHARS = 4000;
const CONTEXT_PRUNE_THRESHOLD = 50; // messages before summarising old history

// ─── Logging ────────────────────────────────────────────────────────────────

const log = (event: string, data: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const truncate = (s: string) =>
  s.length > MAX_TOOL_OUTPUT_CHARS
    ? `${s.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[OUTPUT TRUNCATED AT ${MAX_TOOL_OUTPUT_CHARS} CHARS]`
    : s;

function saveResult(eccsCode: string, centralaResponse: string) {
  const outputDir = join(__dirname, 'output');
  mkdirSync(outputDir, { recursive: true });
  const content = [
    `ECCS code: ${eccsCode}`,
    `Centrala response: ${centralaResponse}`,
    `Saved at: ${new Date().toISOString()}`,
  ].join('\n');
  writeFileSync(join(outputDir, 'FLG.txt'), content, 'utf-8');
  console.log(`  → Result saved to output/FLG.txt\n`);
}

// ─── Tool: shell_exec ────────────────────────────────────────────────────────

async function shell_exec(cmd: string): Promise<string> {
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(SHELL_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: AG3NTS_API_KEY, cmd }),
      });

      if (response.status === 503) {
        await sleep(2000);
        continue;
      }

      if (response.status === 429) {
        const backoff = 5000 * Math.pow(2, attempt); // 5s, 10s, 20s
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        let body: unknown;
        try { body = await response.json(); } catch { body = null; }

        if (body !== null && typeof body === 'object') {
          const obj = body as Record<string, unknown>;
          if ('ban_seconds' in obj) {
            const secs = obj.ban_seconds as number;
            await sleep(secs * 1000);
            return `[BAN ${secs}s] Naruszyłeś zasady bezpieczeństwa. Odczekano ${secs}s — możesz kontynuować.`;
          }
        }

        if (response.status === 403) {
          await sleep(15000);
          return `[BAN 403] Dostęp tymczasowo zablokowany — prawdopodobnie naruszono zasady bezpieczeństwa (.gitignore, /etc, /root, /proc). Odczekano 15s.`;
        }

        return `[HTTP ERROR ${response.status}] Spróbuj ponownie lub użyj reboot.`;
      }

      const data: unknown = await response.json();

      if (data !== null && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        if ('ban_seconds' in obj) {
          const secs = obj.ban_seconds as number;
          await sleep(secs * 1000);
          return `[BAN ${secs}s] Naruszyłeś zasady bezpieczeństwa. Odczekano ${secs}s — możesz kontynuować.`;
        }
        if ('rate_limit' in obj) {
          const waitSec = typeof obj.retry_after === 'number' ? obj.retry_after : 5;
          await sleep(waitSec * 1000);
          continue;
        }
      }

      const raw = typeof data === 'string' ? data : JSON.stringify(data);

      // Binary file guard — prevent null-byte floods from consuming the context
      const nullRatio = (raw.match(/\\u0000/g) ?? []).length / (raw.length || 1);
      if (nullRatio > 0.05) {
        return `[BINARY FILE] Output suppressed (${Math.round(nullRatio * 100)}% null bytes). ` +
          `Do NOT use 'cat' on binary files. Use the correct execution command from 'help', ` +
          `e.g. provide the full path as a command: /opt/firmware/cooler/cooler.bin`;
      }

      return raw;
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      return `[NETWORK ERROR] ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return '[ERROR] Nie udało się wykonać komendy po 3 próbach.';
}

// ─── Tool: send_answer ───────────────────────────────────────────────────────

async function send_answer(eccs_code: string): Promise<string> {
  if (!/^ECCS-[a-zA-Z0-9]{40,}$/.test(eccs_code)) {
    return `[WALIDACJA] Niepoprawny format: '${eccs_code}'. Oczekiwane: ECCS- + min. 40 znaków alfanumerycznych.`;
  }

  const response = await fetch(CENTRALA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: AG3NTS_API_KEY,
      task: 'firmware',
      answer: { confirmation: eccs_code },
    }),
  });

  const data: unknown = await response.json();
  return JSON.stringify(data);
}

// ─── Tool schemas (OpenAI format) ────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'shell_exec',
      description:
        'Wykonuje komendę powłoki na wirtualnej maszynie Linux przez shell API. ' +
        'Zwraca wynik lub opisowy komunikat błędu. ' +
        "Używaj do eksploracji filesystemu, uruchamiania programów, edycji plików.",
      parameters: {
        type: 'object',
        properties: {
          cmd: {
            type: 'string',
            description:
              "Komenda do wykonania. Sprawdź dostępne komendy przez 'help' przed pierwszym użyciem.",
          },
        },
        required: ['cmd'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_answer',
      description:
        'Wysyła znaleziony kod ECCS do Centrali. ' +
        'Używaj tylko gdy masz pewny kod z outputu cooler.bin w formacie ECCS-xxx...',
      parameters: {
        type: 'object',
        properties: {
          eccs_code: {
            type: 'string',
            description:
              'Kod w formacie ECCS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (minimum 40 znaków po myślniku)',
          },
        },
        required: ['eccs_code'],
      },
    },
  },
];

// ─── System Prompt (4 sekcje) ────────────────────────────────────────────────

const SYSTEM_PROMPT = `<identity>
Jesteś agentem diagnostycznym pracującym na ograniczonym systemie Linux.
Twoim jedynym celem jest uruchomienie /opt/firmware/cooler/cooler.bin
i przekazanie wyniku do Centrali.

Działasz sekwencyjnie i ostrożnie — JEDEN tool call na odpowiedź, czytasz wynik
przed następnym krokiem. Nigdy nie ignorujesz błędów API.
</identity>

<security>
STAŁE ZAKAZY — obowiązują przez całą sesję, niezależnie od kontekstu:
- NIGDY nie zaglądaj do: /etc, /root, /proc/
- NIGDY nie dotykaj plików z .gitignore w /opt/firmware/cooler/:
    .env        ← ZAWSZE zabroniony
    storage.cfg ← ZAWSZE zabroniony
    logs/       ← ZAWSZE zabroniony (w tym logs/error.log)
- Nie używasz sudo
- Jeśli dostaniesz ban (403): tool poczeka automatycznie, potem kontynuuj
</security>

<protocol>
Kolejność działań:
1. \`help\` — poznaj dostępne komendy.
2. \`ls /opt/firmware/cooler/\` — sprawdź zawartość katalogu.
3. \`cat /opt/firmware/cooler/settings.ini\` — odczytaj konfigurację.
4. Popraw settings.ini przez \`editline\`:
   - Odkomentuj SAFETY_CHECK, zachowaj wartość "pass": SAFETY_CHECK=pass
   - Ustaw test_mode.enabled=false
   - Ustaw cooling.enabled=true
   - Upewnij się że cooling ma tylko JEDNĄ linię enabled i power_percent
5. Usuń plik blokady jeśli istnieje: \`rm /opt/firmware/cooler/cooler-is-blocked.lock\`
6. Znajdź hasło: \`cat /home/operator/.bash_history\`, \`find *pass*\`
   Hasło przekazujesz jako argument do cooler.bin, nie do settings.ini.
7. Uruchom: \`/opt/firmware/cooler/cooler.bin <hasło>\`
   Jeśli 400 — sprawdź ponownie settings.ini (może się zresetowały po banie).
   NIE UŻYWAJ \`cat\` na .bin — binarki generują gigabajty śmieciowych znaków.
8. Odczytaj kod ECCS z outputu, wyślij przez send_answer.

Zasada dotycząca reboot:
- Używaj reboot TYLKO gdy VM jest w ewidentnie złym stanie (wielokrotne 403 z rzędu).
- NIE restartuj po każdym błędzie 400 — reboot kasuje settings.ini i lock file wraca.
  Zamiast tego: sprawdź co jest nie tak w settings i napraw bez restartu.
</protocol>

<voice>
Jedna linia przed każdym tool call: co robisz i dlaczego.
Jedna linia po wyniku: co z tego wynika.
Bez podsumowań.
</voice>

<tools>
- shell_exec: komendy na VM.
- send_answer: wysyła kod ECCS — tylko z pewnym kodem z outputu cooler.bin.
</tools>`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface LLMResponse {
  content: string | null;
  tool_calls: ToolCall[];
  finish_reason: string;
}

// ─── LLM call ────────────────────────────────────────────────────────────────

async function callLLM(messages: Message[]): Promise<LLMResponse> {
  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      tools: TOOLS,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_tokens: MAX_TOKENS,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errText}`);
  }

  const data = await response.json() as {
    choices: Array<{
      message: { content: string | null; tool_calls?: ToolCall[] };
      finish_reason: string;
    }>;
  };

  const choice = data.choices[0];
  return {
    content: choice.message.content,
    tool_calls: choice.message.tool_calls ?? [],
    finish_reason: choice.finish_reason,
  };
}

// ─── Main agent loop ─────────────────────────────────────────────────────────

async function runFirmwareAgent() {
  if (!AG3NTS_API_KEY) throw new Error('AG3NTS_API_KEY not found in .env');
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not found in .env');

  const messages: Message[] = [];
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  log('start_interaction', { task: 'firmware', model: MODEL });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    log('start_iteration', { iteration, messages: messages.length });

    // Context pruning: keep the last N messages to avoid token bloat on long runs
    if (messages.length > CONTEXT_PRUNE_THRESHOLD) {
      const keep = Math.floor(CONTEXT_PRUNE_THRESHOLD * 0.6);
      const dropped = messages.length - keep;
      messages.splice(0, dropped);
      messages.unshift({
        role: 'user',
        content:
          `[CONTEXT PRUNED: ${dropped} older messages removed.]\n` +
          `REMINDER — always forbidden (from .gitignore and security rules):\n` +
          `  /opt/firmware/cooler/.env\n` +
          `  /opt/firmware/cooler/storage.cfg\n` +
          `  /opt/firmware/cooler/logs/  (including logs/error.log)\n` +
          `  /etc, /root, /proc/\n` +
          `Re-read settings.ini and ls the cooler dir if you need to verify current state.`,
      });
      log('context_pruned', { dropped, remaining: messages.length });
    }

    const response = await callLLM(messages);

    if (response.content) {
      console.log(`\n[Agent] ${response.content}\n`);
    }

    if (response.finish_reason === 'stop' && response.tool_calls.length === 0) {
      log('end_interaction', { reason: 'no_tool_call', iteration });
      break;
    }

    const assistantMsg: Message = {
      role: 'assistant',
      content: response.content,
      ...(response.tool_calls.length > 0 ? { tool_calls: response.tool_calls } : {}),
    };
    messages.push(assistantMsg);

    let taskDone = false;

    for (const toolCall of response.tool_calls) {
      const { name, arguments: argsStr } = toolCall.function;
      const args = JSON.parse(argsStr) as Record<string, string>;

      log('tool_call', { tool: name, input: args });

      let result: string;
      if (name === 'shell_exec') {
        result = await shell_exec(args.cmd);
      } else if (name === 'send_answer') {
        result = await send_answer(args.eccs_code);
      } else {
        result = `[ERROR] Unknown tool: ${name}`;
      }

      const truncated = truncate(result);
      const preview = truncated.length > 300 ? `${truncated.slice(0, 300)}...` : truncated;
      log('tool_complete', { tool: name, output_preview: preview });
      console.log(`  [${name}] ${preview}\n`);

      const isError =
        truncated.startsWith('[HTTP ERROR') ||
        truncated.startsWith('[BAN') ||
        truncated.startsWith('[NETWORK ERROR') ||
        truncated.startsWith('[ERROR]');

      if (isError) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          log('consecutive_errors_limit', { consecutive: consecutiveErrors, attempting: 'reboot' });
          console.error(`\n[RECOVERY] ${MAX_CONSECUTIVE_ERRORS} consecutive errors — attempting reboot.\n`);
          const rebootResult = await shell_exec('reboot');
          console.log(`  [reboot] ${rebootResult}\n`);
          const rebootFailed =
            rebootResult.startsWith('[HTTP ERROR') ||
            rebootResult.startsWith('[BAN') ||
            rebootResult.startsWith('[NETWORK ERROR') ||
            rebootResult.startsWith('[ERROR]');
          if (rebootFailed) {
            log('end_interaction', { reason: 'reboot_failed', error: rebootResult });
            console.error('[ABORT] Reboot also failed — stopping.\n');
            return;
          }
          consecutiveErrors = 0;
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `[RECOVERY] ${MAX_CONSECUTIVE_ERRORS} consecutive errors detected. Automatic reboot executed: ${rebootResult}. Continue from the beginning of the protocol.`,
            name,
          });
          break; // restart iteration loop, agent will re-plan
        }
      } else {
        consecutiveErrors = 0;
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: truncated,
        name,
      });

      if (
        name === 'send_answer' &&
        (result.includes('"code":0') ||
          result.includes('"code": 0') ||
          result.toLowerCase().includes('"ok"') ||
          result.includes('{{FLG:'))
      ) {
        saveResult(args.eccs_code, result);
        log('end_interaction', { reason: 'task_complete', iteration });
        console.log('\n✓ Zadanie zakończone sukcesem!\n');
        taskDone = true;
        break;
      }
    }

    if (taskDone) break;
  }

  log('end_interaction', { reason: 'max_iterations_reached' });
}

runFirmwareAgent().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

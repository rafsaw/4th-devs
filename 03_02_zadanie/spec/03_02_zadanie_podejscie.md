---
created: 2026-05-13
updated: 2026-05-13
type: task-approach
tags: [course/ai-dev4, topic/agents, topic/task, topic/spec]
sources:
  - "[[AI-Devs-4_s03e02/AI-Devs-4_s03e02_07!Zadanie]]"
  - "[[AI-Devs-4_s03e02/AI-Devs-4_s03e02_06!Transkrypcja_filmu_z_Fabula]]"
---

# Zadanie `firmware` — spec-driven design

Zadanie: uruchomić sterownik ECCS (`/opt/firmware/cooler/cooler.bin`) na VM z Linuxem przez shell API. Uzyskać kod `ECCS-xxx...` i odesłać do Centrali.

Wzorce kursu zastosowane w projekcie: [[projektowanie-instrukcji-agenta]] (4 sekcje promptu) · [[function-calling]] (tool loop) · [[produkcyjne-ai]] (error recovery, event-driven loop) · [[bezpieczenstwo-agentow]] (programistyczne ograniczenia) · [[context-engineering]] (zarządzanie kontekstem) · [[observability-agentow]] (trace) · [[code-execution-sandbox]] (deterministyczne obliczenia przez kod zamiast LLM).

---

## 1. Cel i kryteria sukcesu

| Kryterium | Jak weryfikować |
|-----------|-----------------|
| `cooler.bin` uruchomiony poprawnie | stdout zawiera `ECCS-` prefix |
| Kod wysłany do Centrali | `/verify` zwraca `{"code": 0}` lub `"OK"` |
| Żadne zasady bezpieczeństwa nie naruszone | brak banu, VM nie wymagała resetu |
| Agent zakończył autonomicznie | brak ręcznej interwencji w trakcie |

---

## 2. Architektura

```
┌─────────────────────────────────────────────┐
│              Agent Loop (event-driven)       │
│                                             │
│  system_prompt (identity/protocol/tools)    │
│       ↓                                     │
│  [ start_iteration ]                        │
│       ↓                                     │
│  LLM (claude-sonnet-4-6) → tool_select      │
│       ↓                                     │
│  tool_call → tool_complete                  │
│       ↓                                     │
│  [ kolejna iteracja lub end_interaction ]   │
└──────────────┬──────────────────────────────┘
               │
       ┌───────┴───────┐
       ↓               ↓
  shell_exec()    send_answer()
  (HTTP POST)     (HTTP POST)
  hub.ag3nts.org  centrala.ag3nts.org
```

**Dlaczego event-driven loop (s01e05):** pozwala na heartbeat (postęp widoczny), wznawianie po błędzie, logging każdej iteracji do trace (Langfuse/własny).

**Dlaczego 2 narzędzia (s02e05 — minimal toolset):** agent nie potrzebuje więcej. Minimalna powierzchnia = mniejsze ryzyko nieoczekiwanych kombinacji narzędzi.

---

## 3. System Prompt (4 sekcje — s02e05)

### `<identity>`

```
Jesteś agentem diagnostycznym pracującym na ograniczonym systemie Linux.
Twoim jedynym celem jest uruchomienie /opt/firmware/cooler/cooler.bin
i przekazanie wyniku do Centrali.

Działasz sekwencyjnie i ostrożnie. Każda komenda to jedno zapytanie —
planujesz przed wykonaniem, czytasz wynik przed następnym krokiem.
Nie zakładasz niczego o środowisku zanim nie sprawdzisz przez `help`.

Jeśli napotkasz ograniczenie (ban, błąd, nieznana komenda) — zatrzymujesz się,
analizujesz komunikat i adaptujesz plan. Nigdy nie ignorujesz błędu API.
```

*Dlaczego tak:* "show don't tell" (s02e05) — nie lista reguł, a persona. "Sekwencyjnie i ostrożnie" kieruje uwagą modelu na ostrożność bez wypisywania każdej zasady.

### `<protocol>`

```
Sekwencja pracy:
1. ZAWSZE zacznij od komendy `help` — nie zakładaj dostępnych poleceń.
2. Zbadaj strukturę /opt/firmware/cooler/ (ls lub odpowiednik z help).
3. Sprawdź czy istnieje .gitignore w bieżącej lokalizacji — jeśli tak, przeczytaj go
   i zapamiętaj listę zabronionych ścieżek. Nie dotykaj tych plików/katalogów.
4. Spróbuj uruchomić cooler.bin. Przeczytaj błąd jeśli wystąpi.
5. Znajdź hasło dostępowe (zadanie mówi: "zapisane w kilku miejscach w systemie").
6. Sprawdź settings.ini — zrozum co jest niepoprawnie skonfigurowane.
7. Popraw konfigurację używając dostępnego edytora (sprawdź przez help).
8. Uruchom ponownie. Odczytaj kod ECCS.
9. Wyślij kod przez send_answer.

Zasady bezpieczeństwa (naruszenie = ban):
- Nie zaglądaj do /etc, /root, /proc/
- Respektuj .gitignore: nie dotykaj wymienionych plików i katalogów
- Działasz na koncie zwykłego użytkownika — nie używasz sudo
- Jeśli dostaniesz ban: poczekaj tyle sekund ile wskazuje komunikat, spróbuj ponownie

Jeśli coś jest mocno pomieszane: użyj komendy reboot żeby zresetować VM.
```

*Dlaczego tak:* protocol zawiera strukturę kroków + zasady bezpieczeństwa. `.gitignore` jako czarna lista to bezpośrednie zastosowanie progressive access isolation (s03e02) — programistyczne ograniczenie, które agent respektuje przez instrukcję. Zabezpieczenia są też w narzędziu (poziom kodu — s02e05).

### `<voice>`

```
Zwięźle. Jedno zdanie per myśl.
Przed każdym wywołaniem narzędzia: jedna linia co robisz i dlaczego.
Po wyniku narzędzia: jedna linia co z tego wynika.
Bez podsumowań na końcu — działasz, nie opowiadasz.
```

*Dlaczego tak:* zadanie nie wymaga rozbudowanej persony, ale potrzebuje krótkich kroków żeby kontekst nie puchł (s02e01 — okno kontekstowe). Krótkie opisy każdego kroku to też naturalny heartbeat (s03e02).

### `<tools>`

Generowane automatycznie ze schematów (patrz sekcja 4). Bez dodatkowych instrukcji per-narzędzie — schematy są samotłumaczące (s02e05).

---

## 4. Specyfikacja narzędzi (Function Calling)

### `shell_exec`

```json
{
  "name": "shell_exec",
  "description": "Wykonuje komendę powłoki na wirtualnej maszynie Linux przez shell API. Zwraca wynik lub opisowy komunikat błędu. Używaj do eksploracji filesystemu, uruchamiania programów, edycji plików.",
  "parameters": {
    "type": "object",
    "properties": {
      "cmd": {
        "type": "string",
        "description": "Komenda do wykonania. Sprawdź dostępne komendy przez 'help' przed pierwszym użyciem."
      }
    },
    "required": ["cmd"]
  }
}
```

**Implementacja (pseudokod):**

```typescript
async function shell_exec(cmd: string): Promise<string> {
  const MAX_RETRIES = 3;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch("https://hub.ag3nts.org/api/shell", {
      method: "POST",
      body: JSON.stringify({ apikey: API_KEY, cmd }),
      headers: { "Content-Type": "application/json" }
    });

    // HTTP-level errors
    if (response.status === 503) {
      await sleep(2000);
      continue;
    }

    if (!response.ok) {
      return `[HTTP ERROR ${response.status}] Spróbuj ponownie lub użyj reboot.`;
    }

    const data = await response.json();

    // Ban detection (naruszenie zasad)
    if (typeof data === "object" && data.ban_seconds) {
      return `[BAN ${data.ban_seconds}s] Naruszyłeś zasady bezpieczeństwa. Czekaj ${data.ban_seconds} sekund. Użyj reboot jeśli VM jest w złym stanie.`;
    }

    // Rate limit
    if (typeof data === "object" && data.rate_limit) {
      await sleep(data.retry_after * 1000 ?? 5000);
      continue;
    }

    // Success
    return typeof data === "string" ? data : JSON.stringify(data);
  }

  return "[ERROR] Nie udało się wykonać komendy po 3 próbach.";
}
```

*Dlaczego obsługa w narzędziu (nie przez model):* error recovery na poziomie kodu (s01e05) — agent dostaje opis sytuacji, nie raw HTTP, i może sensownie reagować. Model widzi "BAN 30s" nie `{"code": 403, "message": "..."`.

### `send_answer`

```json
{
  "name": "send_answer",
  "description": "Wysyła znaleziony kod ECCS do Centrali. Używaj tylko gdy masz pewny kod w formacie ECCS-xxx... z outputu cooler.bin.",
  "parameters": {
    "type": "object",
    "properties": {
      "eccs_code": {
        "type": "string",
        "description": "Kod w formacie ECCS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    },
    "required": ["eccs_code"]
  }
}
```

**Implementacja:**

```typescript
async function send_answer(eccs_code: string): Promise<string> {
  // Programistyczna walidacja formatu — nie ufaj modelowi (s01e05)
  if (!eccs_code.match(/^ECCS-[a-zA-Z0-9]{40,}$/)) {
    return `[WALIDACJA] Kod ma niepoprawny format: '${eccs_code}'. Oczekiwany: ECCS- + ciąg znaków.`;
  }

  const response = await fetch("https://centrala.ag3nts.org/report", {
    method: "POST",
    body: JSON.stringify({
      apikey: API_KEY,
      task: "firmware",
      answer: { confirmation: eccs_code }
    }),
    headers: { "Content-Type": "application/json" }
  });

  const data = await response.json();
  return JSON.stringify(data);
}
```

*Dlaczego walidacja formatu w kodzie:* "dane z zewnątrz przez kod, nie przez model" (s01e02 — trzy zasady). Halucynowany kod zostaje zablokowany zanim trafi do Centrali.

---

## 5. Agent Loop (event-driven — s01e05)

```typescript
async function runFirmwareAgent() {
  const messages: Message[] = [];
  
  // start_interaction event
  log({ event: "start_interaction", task: "firmware" });

  while (true) {
    // start_iteration event
    log({ event: "start_iteration", message_count: messages.length });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      system: buildSystemPrompt(),   // identity + protocol + voice + tools
      messages,
      tools: [SHELL_EXEC_TOOL, SEND_ANSWER_TOOL],
      max_tokens: 1024
    });

    // tool_select event
    if (response.stop_reason === "end_turn") {
      log({ event: "end_interaction", reason: "no_tool_call" });
      break;
    }

    for (const block of response.content) {
      if (block.type === "tool_use") {
        log({ event: "tool_call", tool: block.name, input: block.input });

        const result = block.name === "shell_exec"
          ? await shell_exec(block.input.cmd)
          : await send_answer(block.input.eccs_code);

        log({ event: "tool_complete", tool: block.name, output: result });

        // Zakończ jeśli send_answer zwróciło sukces
        if (block.name === "send_answer" && result.includes('"code":0')) {
          log({ event: "end_interaction", reason: "task_complete" });
          return;
        }

        messages.push(/* tool result */);
      }
    }

    messages.push(/* assistant message */);
  }
}
```

*Dlaczego:* event-driven loop z logowaniem każdego zdarzenia — naturalny punkt dla obserwability (s03e01). `log()` to subskrybent zdarzeń który może pisać do Langfuse lub własnego systemu.

---

## 6. Zarządzanie kontekstem (s02e01)

**Ryzyko:** zadanie może wymagać wielu kroków eksploracji → historia rośnie → model zaczyna "zapominać" wczesne instrukcje.

**Mitygacja:**
- `max_tokens: 1024` — wymusza krótkie odpowiedzi modelu (s03e02 — output tokens)
- System prompt nie zmienia się między iteracjami — kwalifikuje do prompt cache (s03e02 — cache)
- Jeśli historia > N wiadomości: podsumuj wyniki eksploracji jako jeden assistant message i usuń szczegółowy log (observational memory light — s02e03)

**Estymacja rozmiaru:** zadanie powinno zmieścić się w 15–25 iteracjach. Każda iteracja: ~200 input tokens (historia) + ~800 (system prompt) + ~100 output. Łącznie: ~25k tokenów.

---

## 7. Obserwability (s03e01)

Minimum dla debugowania gdy agent utknął:

```
Session: firmware_task_{timestamp}
  Trace: agent_run
    Span: exploration          # kroki 1-3 (help, ls, gitignore)
    Span: password_search      # krok 4-5
    Span: configuration_fix    # krok 6-7
    Span: verification         # krok 8-9
      Generation: shell_exec calls
      Tool: send_answer
```

Dla każdego `tool_call` loguj: `cmd`, wynik, czas odpowiedzi. Ban detection widoczny jako anomalia w Span.

---

## 8. Macierz ryzyk i mitygacji

| Ryzyko | Skąd | Mitygacja |
|--------|------|-----------|
| Naruszenie zasad bezpieczeństwa (ban) | Agent zajrzy do /etc lub .gitignore pliku | Protokół w system promptie; ban_seconds w komunikacie; reboot jako reset |
| Model zakłada standardowe komendy Linux | Niestandardowy shell API | `help` jako krok #1 w protokole; persona "nie zakładaj niczego" |
| Halucynowany kod ECCS | Model zgaduje format | Programistyczna walidacja regex w `send_answer` przed wysłaniem |
| Powiększający się kontekst | Długa eksploracja | max_tokens; opcjonalne podsumowanie historii |
| Rate limit / 503 | Infrastruktura API | Retry z exponential backoff w `shell_exec` |
| Zablokowana VM w złym stanie | Błąd konfiguracji nie do naprawienia | `reboot` jako narzędzie "nuclear option" wymienione w protokole |

---

## 9. Checklist implementacji

- [ ] `shell_exec` z obsługą: ban, rate_limit, 503, max_retries
- [ ] `send_answer` z regex walidacją formatu ECCS przed wysłaniem
- [ ] System prompt: 4 sekcje (identity/protocol/voice/tools)
- [ ] Protocol zawiera kroki 1–9 + zasady bezpieczeństwa
- [ ] Event logging: start/end interaction, tool_call, tool_complete
- [ ] `max_tokens: 1024` w wywołaniu modelu
- [ ] Model: `claude-sonnet-4-6` (nie mini/haiku — zadanie wymaga reasoning)
- [ ] Prompt cache: system prompt stabilny między iteracjami

---

## Powiązane koncepty kursu

- [[projektowanie-instrukcji-agenta]] — 4 sekcje promptu, show don't tell, minimal toolset
- [[function-calling]] — mechanizm FC, pętla tool use, schema narzędzi
- [[produkcyjne-ai]] — event-driven loop, error recovery, heartbeat, zarządzanie kosztami
- [[bezpieczenstwo-agentow]] — programistyczne ograniczenia, walidacja przed akcją, gitignore jako czarna lista
- [[context-engineering]] — max_tokens, prompt cache, okno kontekstu
- [[observability-agentow]] — hierarchia Session/Trace/Span dla debugowania
- [[code-execution-sandbox]] — analogia: kod zamiast LLM do deterministycznych operacji (tu: walidacja regex zamiast "sprawdź modelem")
- [[s03e02]] — lekcja źródłowa

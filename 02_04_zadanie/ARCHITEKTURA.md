# Architektura implementacji — `s02e04 mailbox`

Dokument opisuje rzeczywistą architekturę i zachowanie implementacji w `02_04_zadanie` na poziomie kodu uruchomieniowego.

## Szybki widok — diagramy

### 1) Komponenty i dataflow

```mermaid
flowchart LR
    U[Uruchomienie<br/>npx tsx src/index.ts] --> IDX[src/index.ts<br/>Orkiestrator]
    IDX --> CFG[src/config.ts<br/>env + limity]
    IDX --> PRM[src/prompt.ts<br/>system prompt]
    IDX --> TOLS[src/tools.ts<br/>definicje FC]
    IDX --> LLM[OpenRouter LLM<br/>chat.completions]

    IDX --> ZM[src/zmail.ts<br/>adapter API zmail]
    ZM --> ZAPI[(ZMAIL API<br/>/api/zmail)]

    IDX --> HUB[src/hub.ts<br/>verify()]
    HUB --> HAPI[(HUB API<br/>/verify)]

    IDX --> OUT1[(output/run-*.json)]
    IDX --> OUT2[(output/flag.txt)]
```

### 2) Sekwencja runtime (jedna lub wiele iteracji)

```mermaid
sequenceDiagram
    participant M as main()/run()
    participant Z as zmail API
    participant L as LLM (OpenRouter)
    participant T as runTool()
    participant H as hub /verify

    M->>Z: help
    Z-->>M: actions + params
    M->>L: system prompt + help + tools

    loop do MAX_ITER
        L-->>M: assistant + tool_call
        M->>T: runTool(name,args)
        alt zmail_* tool
            T->>Z: search/getInbox/getThread/getMessages
            Z-->>T: wynik JSON
            T-->>M: tool result (dla read: <email_content>)
        else submit_answer
            T->>T: regex validation (SEC, date, empty payload)
            alt valid payload
                T->>H: POST /verify
                H-->>T: feedback / {FLG:...}
            else invalid payload
                T-->>M: ok:false (bez wywołania huba)
            end
            T-->>M: tool result + optional flag
        else wait_seconds / finish
            T-->>M: kontrola pętli
        end
        M->>L: kolejny krok (conversation + tool result)
    end

    M->>M: zapis output/run-*.json
    alt flag found
        M->>M: zapis output/flag.txt, exit 0
    else no flag
        M->>M: exit 1
    end
```

### 3) Logika decyzyjna `submit_answer`

```mermaid
flowchart TD
    A[submit_answer args] --> B{Czy puste?<br/>brak date/password/code}
    B -- tak --> E1[ok:false<br/>Pusty answer<br/>bez call do huba]
    B -- nie --> C{confirmation_code<br/>pasuje ^SEC-.32?$}
    C -- nie --> E2[ok:false<br/>Bledny SEC format<br/>bez call do huba]
    C -- tak --> D{date pasuje<br/>YYYY-MM-DD?}
    D -- nie --> E3[ok:false<br/>Bledna data<br/>bez call do huba]
    D -- tak --> H[POST /verify]
    H --> I{Czy znaleziono<br/>FLG regex?}
    I -- tak --> J[flag set + kontynuuj do finish]
    I -- nie --> K[feedback huba do kolejnych iteracji]
```

### 4) Rzeczywisty przebieg z `run-2026-05-07T18-12-01-672Z.json`

Poniższy diagram jest odwzorowaniem tego konkretnego runa (6 iteracji, flaga `{FLG:TRAITOR}`), z zachowaniem kolejności narzędzi i przepływu danych.

```mermaid
sequenceDiagram
    autonumber
    participant IDX as src/index.ts (orchestrator)
    participant PR as src/prompt.ts
    participant LLM as OpenRouter model
    participant ZM as src/zmail.ts
    participant ZAPI as ZMAIL API (/api/zmail)
    participant HUB as src/hub.ts
    participant VAPI as HUB API (/verify)
    participant OUT as output/*

    Note over IDX: START RUN
    IDX->>ZM: zmailHelp()
    ZM->>ZAPI: POST {action:"help", apikey}
    ZAPI-->>ZM: actions + params
    ZM-->>IDX: helpInfo (JSON/text)
    IDX->>PR: buildSystemPrompt(helpInfo)
    PR-->>IDX: system prompt (strategia + bezpieczenstwo)
    IDX->>LLM: chat.completions(messages=[system], tools schema)

    Note over IDX,LLM: Iteracja 1 (decyzja modelu)
    Note over LLM: Wejscie: system prompt + help API\nDecyzja: zacznij od filtrowania trusted nadawcy
    LLM-->>IDX: tool_call zmail_search({"query":"from:proton.me"})
    IDX->>ZM: zmailSearch("from:proton.me", page=1)
    ZM->>ZAPI: POST {action:"search", query, page, perPage}
    ZAPI-->>ZM: 1 kandydat (rowID/messageID/threadID...)
    ZM-->>IDX: tool result JSON
    IDX->>LLM: chat.completions(messages += search result: 1 item metadata)

    Note over IDX,LLM: Iteracja 2 (decyzja modelu)
    Note over LLM: Wejscie: 1 wynik search\nDecyzja: przeczytaj pelna tresc kandydata
    LLM-->>IDX: tool_call zmail_read({"message_id":"6624add0..."})
    IDX->>ZM: zmailGetMessages(["6624add0..."])
    ZM->>ZAPI: POST {action:"getMessages", ids:[...]}
    ZAPI-->>ZM: full message body (mail od proton.me)
    ZM-->>IDX: JSON with message content
    IDX->>IDX: wrapUntrusted("<email_content>...</email_content>")
    IDX->>LLM: chat.completions(messages += tool content: <email_content> single mail)

    Note over IDX,LLM: Iteracja 3 (decyzja modelu)
    Note over LLM: Wejscie: tresc pierwszego maila\nDecyzja: uruchom szerokie query po hasle/kodzie/dacie
    LLM-->>IDX: tool_call zmail_search({"query":"password OR hasło OR system OR SEC- OR atak OR elektrownia"})
    IDX->>ZM: zmailSearch(wide_query, page=1)
    ZM->>ZAPI: POST search
    ZAPI-->>ZM: 13 wyników (w tym security + hasło + ticket SEC)
    ZM-->>IDX: metadata list
    IDX->>LLM: chat.completions(messages += search result: 13 item metadata list)

    Note over IDX,LLM: Iteracja 4 (decyzja modelu)
    Note over LLM: Wejscie: 13 metadanych z search\nDecyzja: ranking i selekcja top 3 ID do batch read
    LLM-->>IDX: tool_call zmail_read({"ids":["21f3f311...","318c21f2...","a7353b90..."]})
    IDX->>ZM: zmailGetMessages(batch ids)
    ZM->>ZAPI: POST {action:"getMessages", ids:[3x]}
    ZAPI-->>ZM: 3 pelne wiadomosci
    ZM-->>IDX: payload with:
    Note over ZM,IDX: password=RABARBAR25, date=2026-03-23, code=SEC-c1e...8ceb
    IDX->>IDX: wrapUntrusted(email payload)
    IDX->>LLM: chat.completions(messages += tool content: <email_content> batch 3 mails)

    Note over IDX,LLM: Iteracja 5 (decyzja modelu)
    Note over LLM: Wejscie: 3 pelne maile\nDecyzja: zloz komplet 3 pol i wywolaj submit_answer
    LLM-->>IDX: tool_call submit_answer({...3 pola...})
    IDX->>IDX: local validation (SEC_REGEX + DATE_REGEX + non-empty)
    IDX->>HUB: verify(answer)
    HUB->>VAPI: POST /verify {apikey, task:"mailbox", answer}
    VAPI-->>HUB: {"code":0,"message":"{FLG:TRAITOR}"}
    HUB-->>IDX: flag_detected="{FLG:TRAITOR}"
    IDX->>LLM: chat.completions(messages += user: "Otrzymałeś flagę... Wywołaj finish.")

    Note over IDX,LLM: Iteracja 6 (decyzja modelu)
    Note over LLM: Wejscie: feedback z flaga\nDecyzja: zakoncz run przez finish
    LLM-->>IDX: tool_call finish({"reason":"..."})
    IDX->>IDX: finishReason set, loop end

    IDX->>OUT: save output/run-<timestamp>.json (pelna konwersacja)
    IDX->>OUT: save output/flag.txt = {FLG:TRAITOR}
    Note over OUT: EXIT CODE 0
```

### 5) Rzeczywisty przebieg z `run-2026-05-07T20-15-45-598Z.json` (z `llmTrace`)

Ten diagram opiera sie o nowy format trace (`llmTrace`), czyli per iteracja pokazuje:
- `requestMessages` (co poszlo do modelu),
- `responseMessage.tool_calls` (co model wybral),
- `toolExecutions` (co system faktycznie wykonal i odeslal do kolejnego calla).

```mermaid
sequenceDiagram
    autonumber
    participant IDX as src/index.ts
    participant LLM as OpenRouter model
    participant ZM as src/zmail.ts
    participant ZAPI as ZMAIL API
    participant HUB as src/hub.ts
    participant VAPI as HUB /verify
    participant TRACE as run-2026-05-07T20-15-45-598Z.json

    Note over IDX,TRACE: Iteration 1 (llmTrace[0])
    IDX->>LLM: requestMessages=[system]
    LLM-->>IDX: responseMessage.tool_calls=[zmail_search{"query":"from:proton.me"}]
    IDX->>ZM: runTool(zmail_search)
    ZM->>ZAPI: search(from:proton.me)
    ZAPI-->>ZM: 1 wynik
    ZM-->>IDX: tool result (metadata)
    IDX->>TRACE: save llmTrace[0]{request,response,toolExecutions}

    Note over IDX,TRACE: Iteration 2 (llmTrace[1])
    IDX->>LLM: requestMessages=conversation + tool(search:1)
    LLM-->>IDX: tool_calls=[zmail_read{"message_id":"6624add090a5cb06f5c192653b5a243c"}]
    IDX->>ZM: runTool(zmail_read)
    ZM->>ZAPI: getMessages([6624add0...])
    ZAPI-->>ZM: 1 pelna wiadomosc
    ZM-->>IDX: tool result (<email_content>...)
    IDX->>TRACE: save llmTrace[1]

    Note over IDX,TRACE: Iteration 3 (llmTrace[2])
    IDX->>LLM: requestMessages=conversation + 1 mail content
    LLM-->>IDX: tool_calls=[zmail_search{"query":"password OR \"system pracowniczy\" OR \"SEC-\" OR \"kod potwierdzenia\" OR \"atak\""}]
    IDX->>ZM: runTool(zmail_search)
    ZM->>ZAPI: search(wide query)
    ZAPI-->>ZM: 15 wynikow (metadata)
    ZM-->>IDX: tool result (lista kandydatow)
    IDX->>TRACE: save llmTrace[2]

    Note over IDX,TRACE: Iteration 4 (llmTrace[3])
    IDX->>LLM: requestMessages=conversation + search:15
    Note over LLM: Decyzja modelu: selekcja 3 IDs z listy 15
    LLM-->>IDX: tool_calls=[zmail_read{"ids":["2db742c1...","d482cf37...","a7353b90..."]}]
    IDX->>ZM: runTool(zmail_read batch)
    ZM->>ZAPI: getMessages(3 IDs)
    ZAPI-->>ZM: 3 pelne maile
    ZM-->>IDX: password/date/code w tresci
    IDX->>TRACE: save llmTrace[3]

    Note over IDX,TRACE: Iteration 5 (llmTrace[4])
    IDX->>LLM: requestMessages=conversation + batch read (3 mails)
    LLM-->>IDX: tool_calls=[submit_answer{password,date,confirmation_code}]
    IDX->>IDX: local regex validation (SEC + DATE + non-empty)
    IDX->>HUB: verify(answer)
    HUB->>VAPI: POST /verify
    VAPI-->>HUB: {code:0,message:"{FLG:TRAITOR}"}
    HUB-->>IDX: flag={FLG:TRAITOR}
    IDX->>TRACE: save llmTrace[4]

    Note over IDX,TRACE: Iteration 6 (llmTrace[5])
    IDX->>LLM: requestMessages=conversation + user("Wywolaj finish")
    LLM-->>IDX: tool_calls=[finish{"reason":"..."}]
    IDX->>TRACE: save llmTrace[5]
    Note over IDX: finishReason set, run end
```

## 1. Cel systemu

Aplikacja uruchamia agenta Function Calling, który:
- przeszukuje skrzynkę przez API zmail,
- wyciąga 3 pola: `date`, `password`, `confirmation_code`,
- wysyła odpowiedzi do huba (`task=mailbox`),
- zapisuje flagę `{FLG:...}` do pliku wynikowego.

Model steruje narzędziami, a kod TypeScript pełni rolę orkiestratora i warstwy bezpieczeństwa/walidacji.

## 2. Architektura logiczna

System ma architekturę "single-agent orchestrator":

1. **Orkiestrator pętli (`src/index.ts`)**
   - utrzymuje konwersację,
   - woła LLM i wykonuje `tool_calls`,
   - kończy po `finish`, `max_iter` lub braku sensownej odpowiedzi modelu.
2. **Adapter API poczty (`src/zmail.ts`)**
   - jedna funkcja transportowa `call(action, extra)`,
   - mapowanie na akcje: `help`, `search`, `getInbox`, `getThread`, `getMessages`.
3. **Adapter weryfikacji (`src/hub.ts`)**
   - wywołanie `POST /verify`,
   - ekstrakcja flagi regexem z surowej odpowiedzi.
4. **Kontrakt narzędzi dla modelu (`src/tools.ts`)**
   - definicje Function Calling (nazwy, opisy, JSON Schema),
   - regexy walidacyjne używane w runtime.
5. **Warstwa prompt/injection-safety (`src/prompt.ts`)**
   - dynamiczny system prompt z wynikiem `zmail help`,
   - separator treści niezaufanej: `<email_content>`.
6. **Konfiguracja (`src/config.ts`)**
   - ładowanie `.env`,
   - walidacja kluczy wymaganych.

## 3. Struktura kodu i odpowiedzialności

- `src/config.ts`
  - `required(name)` wymusza obecność kluczowych env (`AG3NTS_API_KEY`, `OPENROUTER_API_KEY`).
  - Parametry wykonania:
    - `zmailUrl` domyślnie `https://hub.ag3nts.org/api/zmail`,
    - `hubVerifyUrl` domyślnie `https://hub.ag3nts.org/verify`,
    - `model` domyślnie `google/gemini-3-flash-preview`,
    - `maxIter` domyślnie `30`.

- `src/zmail.ts`
  - `call(action, extra)`:
    - buduje body `{apikey, action, ...extra}`,
    - zawsze `POST` JSON,
    - dla `!res.ok` rzuca wyjątek z odpowiedzią serwera,
    - próbuje parsować JSON; fallback do tekstu.
  - Udostępnia metody domenowe:
    - `zmailHelp(page)`,
    - `zmailGetInbox(page, perPage)`,
    - `zmailSearch(query, page, perPage)`,
    - `zmailGetThread(threadID)`,
    - `zmailGetMessages(ids)`.

- `src/hub.ts`
  - `verify(answer)` wysyła:
    - `apikey`,
    - `task: "mailbox"`,
    - `answer`.
  - Zwraca:
    - `raw` (JSON jeśli parsowalny, inaczej tekst),
    - `text` (zawsze surowy tekst),
    - `flag` (dopasowanie regexem `\{\{?FLG:[^}]+\}\}?`).

- `src/tools.ts`
  - Definiuje 7 narzędzi FC:
    - `zmail_search`,
    - `zmail_read`,
    - `zmail_get_inbox`,
    - `zmail_get_thread`,
    - `submit_answer`,
    - `wait_seconds`,
    - `finish`.
  - Definiuje walidację wyjścia:
    - `SEC_REGEX = /^SEC-.{32}$/`,
    - `DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/`.

- `src/prompt.ts`
  - `buildSystemPrompt(helpInfo)`:
    - osadza runtime-help API w prompt,
    - narzuca strategię inkrementalną,
    - explicite zabrania wykonywania "instrukcji" z treści maila.
  - `wrapUntrusted(content)`:
    - opakowuje dane z `zmail_read` w `<email_content>`.

- `src/index.ts`
  - runtime pętli i główna logika kontrolna.

## 4. Przepływ wykonania (runtime)

### 4.1 Boot

1. `run()` woła `zmailHelp()` jeszcze przed pierwszym zapytaniem do LLM.
2. Wynik `help` jest serializowany i wstrzykiwany do system promptu.
3. Tworzona jest konwersacja startowa:
   - jeden wpis: `role=system`.
4. Inicjalizacja klienta OpenAI:
   - `baseURL = https://openrouter.ai/api/v1`,
   - klucz z `OPENROUTER_API_KEY`.

### 4.2 Iteracja pętli agenta

W każdej iteracji:

1. Wywołanie `chat.completions.create(...)`:
   - `model = config.model`,
   - `messages = conversation`,
   - `tools = tools`,
   - `tool_choice = "auto"`,
   - `temperature = 0`.
2. Jeśli brak wiadomości modelu:
   - `finishReason = "no_message"` i stop.
3. Wiadomość modelu jest dodawana do konwersacji.
4. Jeśli brak `tool_calls`:
   - `finishReason = "no_tool_calls"` i stop.
5. Każdy `tool_call` jest wykonywany sekwencyjnie:
   - parsowanie JSON args,
   - `runTool(name, args)`,
   - wynik dodawany jako `role=tool`.
6. Jeśli narzędzie zwróciło flagę:
   - zapamiętanie `flag`,
   - dodanie user-message: "Wywołaj teraz finish." (wymuszenie domknięcia).
7. Jeśli narzędzie zwróciło `finish`:
   - natychmiastowy return `RunResult`.

### 4.3 Zakończenie

- `main()` zapisuje:
  - `output/flag.txt` gdy `flag` istnieje,
  - zawsze `output/run-<ISO>.json` z pełnym przebiegiem.
- Exit code:
  - `0` gdy flaga,
  - `1` gdy brak flagi,
  - `2` dla błędu fatalnego.

## 5. Kontrakt narzędzi i mapowanie do backendów

- `zmail_search(query, page?)`
  - backend: `zmailSearch(query, page)`,
  - wynik: JSON metadanych (bez treści).

- `zmail_get_inbox(page?)`
  - backend: `zmailGetInbox(page)`,
  - wynik: lista skrzynki.

- `zmail_get_thread(thread_id)`
  - backend: `zmailGetThread(thread_id)`.

- `zmail_read(ids[] | message_id)`
  - backend: `zmailGetMessages(ids)`,
  - specjalne zachowanie: wynik opakowany przez `wrapUntrusted`.

- `submit_answer({date?, password?, confirmation_code?})`
  - walidacja lokalna PRZED `POST /verify`:
    - błędny `confirmation_code` => odpowiedź tool `ok:false`, brak call do huba,
    - błędna `date` => odpowiedź tool `ok:false`, brak call do huba,
    - puste body => odpowiedź tool `ok:false`, brak call do huba.
  - poprawne dane => `verify(...)`.

- `wait_seconds(seconds)`
  - clamp 1..30,
  - `sleep(seconds * 1000)`.

- `finish(reason)`
  - sygnał kontrolny do przerwania pętli.

## 6. Warstwa bezpieczeństwa i odporności

### 6.1 Ochrona przed prompt injection

- Dane z `zmail_read` trafiają do LLM tylko jako `<email_content>...</email_content>`.
- System prompt explicite mówi, że ta strefa to dane, nie instrukcje.

### 6.2 Walidacja danych przed akcją krytyczną

- `submit_answer` blokuje zły format daty i kodu `SEC-*` lokalnie.
- Dzięki temu hub nie jest zasypywany błędnymi payloadami wynikającymi z halucynacji.

### 6.3 Granice iteracji

- `MAX_ITER` ogranicza długość działania.
- Dodatkowe bezpieczniki:
  - stop przy `no_tool_calls`,
  - stop przy `no_message`.

### 6.4 Obsługa błędów narzędzi

- Wyjątek z dowolnego narzędzia jest zamieniany na odpowiedź JSON `ok:false` i trafia do konwersacji.
- Agent może zareagować i skorygować strategię bez crashu procesu.

## 7. Obserwowalność i artefakty

- Log konsolowy:
  - `"[boot] zmail help..."`,
  - `"[iter N] tool <nazwa> <args>"`,
  - `"[iter N] FLAG DETECTED: ..."`.
- Artefakty:
  - `output/flag.txt` — pojedyncza linia z flagą,
  - `output/run-*.json` — pełny transcript (`system`, `assistant`, `tool`, `user`).

`run-*.json` jest kluczowy diagnostycznie: umożliwia analizę wyboru narzędzi, argumentów i odpowiedzi backendów bez powtarzania całego wykonania.

## 8. Parametryzacja i uruchamianie

Wymagane środowisko:
- `OPENROUTER_API_KEY`,
- `AG3NTS_API_KEY`.

Opcjonalne nadpisania:
- `ZMAIL_URL`,
- `HUB_VERIFY_URL`,
- `MODEL`,
- `MAX_ITER`.

Start:
- `npm install`
- `npx tsx src/index.ts` (lub `npm run start`)

Smoke test API:
- `npx tsx src/smoke.ts`

## 9. Przykładowa sekwencja sukcesu (z realnego runu)

Zaobserwowany scenariusz:
1. `zmail_search("from:proton.me")`,
2. `zmail_read(...)` wiadomości zgłoszeniowej,
3. szeroki `zmail_search("password OR ... OR SEC- ...")`,
4. batch `zmail_read` kilku kandydatów,
5. `submit_answer` kompletem pól,
6. hub zwraca `{FLG:TRAITOR}`,
7. agent wywołuje `finish`.

W tym przebiegu flaga została uzyskana po 6 iteracjach.

## 10. Ograniczenia obecnej implementacji

- Brak silnego typowania odpowiedzi zmail/hub (runtime operuje głównie na `unknown` + JSON string).
- Brak automatycznej deduplikacji/priorytetyzacji kandydatów po metadanych (decyzję podejmuje model).
- Brak retry HTTP na poziomie transportu (poza retry logicznym realizowanym przez LLM przez kolejne tool calls).
- Brak testów automatycznych (jedynie `smoke.ts`).

## 11. Możliwe rozszerzenia techniczne

1. Dodać warstwę DTO + walidację schema (`zod`) dla odpowiedzi zmail/hub.
2. Dodać retry/backoff dla `fetch` (np. 429/5xx).
3. Rozdzielić logikę agenta i IO, by łatwo pisać testy integracyjne.
4. Dodać metryki per iteracja (czas, liczba tool calls, koszt tokenów).
5. Dodać prostą pamięć lokalną faktów (`date/password/code`) jako jawny stan, by ograniczyć ryzyko regresu modelu między iteracjami.
# Architektura `s02e04 mailbox` - wersja do odswiezenia wiedzy

Ten plik jest napisany pod szybki powrot do projektu po przerwie.
Cel: w 5-10 minut przypomniec sobie jak to dziala, dlaczego tak, i gdzie najczesciej peka.

---

## 1) TL;DR w 60 sekund

- To jest **agent iteracyjny**, nie one-shot.
- Agent robi cykl: **sprawdz dane -> wybierz narzedzie -> wykonaj -> ocen wynik**.
- Narzedzia (`zmail_*`, `submit_answer`, `wait_seconds`, `finish`) sa jedyna droga do akcji.
- `submit_answer` ma lokalne guardraile (regex + pusty payload check) przed wywolaniem huba.
- Dane z maili sa traktowane jako **untrusted** (`<email_content>`), zeby ograniczyc prompt injection.
- Sukces: znalezienie `{FLG:...}`, zapis do `output/flag.txt`, pelny trace do `output/run-*.json`.

---

## 2) Mental model (najwazniejsze)

Mysl o tym systemie jak o kierowcy i kokpicie:

- **Model (LLM)** = kierowca decyzji.
- **Narzędzia** = pedaly i kierownica (jedyne akcje w swiecie zewnetrznym).
- **Orkiestrator (`src/index.ts`)** = kontrola bezpieczenstwa i telemetry.

### Dwie perspektywy

1. **Architektura**
   - LLM nie ma "magii". Dziala tylko przez jawne API narzedzi.
   - Kod TypeScript pilnuje zasad i wykonania skutkow ubocznych.

2. **Operacja runtime**
   - Kazda iteracja dodaje nowe fakty (`role: "tool"`) do kontekstu.
   - To pozwala agentowi korygowac hipotezy zamiast zgadywac od nowa.

---

## 3) Mapa komponentow i odpowiedzialnosci

- `src/index.ts`
  - petla agenta i orkiestracja rozmowy,
  - wykonywanie `tool_calls`,
  - stop conditions: `finish`, `MAX_ITER`, `no_tool_calls`, `no_message`,
  - zapis artefaktow (`flag.txt`, `run-*.json`).

- `src/tools.ts`
  - kontrakt Function Calling (co model moze wywolac),
  - regexy walidacyjne (`SEC_REGEX`, `DATE_REGEX`).

- `src/zmail.ts`
  - adapter do API skrzynki (`help`, `search`, `getInbox`, `getThread`, `getMessages`).

- `src/hub.ts`
  - adapter `POST /verify`,
  - ekstrakcja flagi regexem z surowej odpowiedzi.

- `src/prompt.ts`
  - system prompt z zasadami strategii,
  - `wrapUntrusted(...)` dla tresci maili.

- `src/config.ts`
  - env + fail-fast na brakujace sekrety,
  - parametry uruchomienia (`MODEL`, `MAX_ITER`, endpointy).

---

## 4) Dlaczego ta architektura (i co jest alternatywa)

## Decyzja A: Petla iteracyjna zamiast one-shot

- **Dlaczego tak:** dane sa rozproszone, czesc moze dojsc pozniej, feedback huba prowadzi kolejne kroki.
- **Zysk:** wyzsza skutecznosc w zadaniach "sledczych".
- **Koszt:** wiekszy koszt tokenow, dluzszy runtime, wiecej punktow awarii.
- **Kiedy to zly wybor:** proste, statyczne zadania z jednym zrodlem danych.

## Decyzja B: Narzedzia zamiast bezposrednich akcji modelu

- **Dlaczego tak:** kontrola skutkow ubocznych i jawny kontrakt dzialan.
- **Zysk:** bezpieczenstwo, audytowalnosc, latwiejszy debug.
- **Koszt:** wiecej kodu i obslugi bledow.
- **Kiedy to zly wybor:** bardzo prosty skrypt bez systemow zewnetrznych.

## Decyzja C: Lokalna walidacja przed `POST /verify`

- **Dlaczego tak:** odcina oczywiste bledy zanim pojda do huba.
- **Zysk:** mniej pustych/blednych requestow, szybszy feedback dla agenta.
- **Koszt:** regex sprawdza format, nie prawde semantyczna.
- **Kiedy to zly wybor:** gdy format jest niestabilny i zmienia sie czesto.

## Decyzja D: `temperature: 0`

- **Dlaczego tak:** celem jest ekstrakcja faktow, nie kreatywnosc.
- **Zysk:** powtarzalnosc i latwiejszy debug.
- **Koszt:** mniejsza elastycznosc przy niejednoznacznych przypadkach.
- **Kiedy to zly wybor:** zadania tworcze lub wymagajace generowania wielu hipotez.

---

## 5) Szybki przebieg runtime (co sie dzieje po kolei)

1. Boot: `zmailHelp()` -> `buildSystemPrompt(helpInfo)` -> start conversation.
2. Iteracja:
   - model zwraca `tool_calls`,
   - orkiestrator uruchamia `runTool(...)`,
   - wynik dopisywany jako `role: "tool"`.
3. `submit_answer`:
   - walidacja lokalna (`SEC`, data, niepuste),
   - dopiero potem `verify(...)`.
4. Gdy jest flaga:
   - dopisanie komunikatu "wywolaj finish",
   - zamkniecie runa przez `finish`.
5. Persist:
   - zawsze `output/run-*.json`,
   - `output/flag.txt` gdy sukces.

---

## 6) Sygnały bledu: objaw -> prawdopodobna przyczyna -> pierwszy ruch

## `finishReason = "no_tool_calls"`

- **Objaw:** model odpowiada bez wywolan narzedzi.
- **Przyczyna:** prompt nie wymusza akcji albo kontekst jest zbyt mglisty.
- **Pierwszy ruch:** sprawdz system prompt i ostatni tool result; doprecyzuj strategie "najpierw akcja, potem ocena".

## `finishReason = "max_iter"`

- **Objaw:** run konczy sie limitem bez flagi.
- **Przyczyna:** petla bez postepu, slabe query, zla selekcja maili.
- **Pierwszy ruch:** otworz `run-*.json`, znajdz pierwsza iteracje bez nowej informacji, popraw prompt lub query pattern.

## Częste `ok:false` z `submit_answer`

- **Objaw:** duzo lokalnych odrzucen payloadu.
- **Przyczyna:** model miesza format daty/kodu lub zgaduje.
- **Pierwszy ruch:** wzmocnij instrukcje ekstrakcji formatu i dodaj krok "zweryfikuj regex przed submit".

## Brak flagi mimo poprawnie wygladajacych danych

- **Objaw:** `submit_answer` przechodzi, ale hub nie daje flagi.
- **Przyczyna:** jedno z pol jest semantycznie bledne mimo poprawnego formatu.
- **Pierwszy ruch:** sprawdz zrodlo kazdego pola w `run-*.json`; potwierdz, czy pochodzi z maila o poprawnym kontekście.

## Duze opoznienia runa

- **Objaw:** iteracje trwaja dlugo, malo postepu.
- **Przyczyna:** nadmiar `wait_seconds` albo zbyt szerokie, kosztowne eksploracje.
- **Pierwszy ruch:** ogranicz czekanie i popraw rankowanie kandydatow przed `zmail_read`.

---

## 7) Jak czytac `run-*.json` po przerwie (3-min procedura)

1. Sprawdz `finishReason` i liczbe iteracji.
2. Przejrzyj `toolExecutions` per iteracja:
   - czy kazda iteracja wnosi nowa informacje?
   - gdzie zaczyna sie powtorzenie?
3. Dla `submit_answer`:
   - czy byl lokalny reject?
   - jesli nie, co dokładnie odpowiedzial hub?
4. Zapisz jedna hipoteze poprawki (prompt / query / selekcja ID) przed kolejnym runem.

---

## 8) Checklisty do pracy

## Przed uruchomieniem

- Czy `.env` ma `OPENROUTER_API_KEY` i `AG3NTS_API_KEY`?
- Czy `MAX_ITER` jest sensowny (nie za niski, nie za wysoki)?
- Czy model jest ustawiony pod ekstrakcje faktow?
- Czy chcesz zrobic szybki `smoke.ts`?

## Po nieudanym runie

- Czy problem to brak narzedzi (`no_tool_calls`) czy brak postepu (`max_iter`)?
- Czy byly lokalne walidacje `ok:false`?
- Czy agent czytal dobre maile (jakość selekcji)?
- Czy z runa wynika jedna konkretna poprawka do wdrozenia?

---

## 9) Granice obecnego rozwiazania (co warto pamietac)

- Odpowiedzi backendow nie sa mocno typowane (duzo `unknown` + JSON fallback).
- Brak retry/backoff transportowego dla HTTP.
- Brak automatycznych testow (poza smoke/manual runs).
- Inteligencja selekcji kandydatow jest glownie po stronie modelu.

To jest OK na etap zadaniowy, ale w produkcji to bylyby glówne punkty do domkniecia.

---

## 10) Plan rozwoju (priorytetowo)

1. Retry/backoff i timeouty dla `fetch`.
2. DTO + walidacja schem odpowiedzi (`zod` lub podobne).
3. Testy integracyjne petli (scenariusze sukces/failure).
4. Metryki per iteracja: czas, liczba tool calls, koszty tokenow.
5. Redakcja danych wrazliwych w trace logach.

---

## 11) Mini pytania kontrolne (do samosprawdzenia)

1. Dlaczego sama walidacja regex nie gwarantuje poprawnej odpowiedzi?
2. Po czym poznasz, ze agent "kreci sie w kolko"?
3. Kiedy `wait_seconds` pomaga, a kiedy tylko spowalnia?
4. Co jest "ostatnia linia obrony" przed nieskonczonym runem?
5. Co najpierw otwierasz po porazce: log konsoli czy `run-*.json` i dlaczego?

Jesli odpowiesz na te 5 pytan poprawnie, masz odswiezony model mentalny calego projektu.

# Architektura projektu: Agent API

## 1. Podsumowanie projektu

**Agent API** to backendowy serwer HTTP, który udostępnia ujednolicone API do prowadzenia konwersacji z agentami AI. Agenci są definiowani jako pliki Markdown, mogą korzystać z narzędzi (tool calling), delegować zadania innym agentom i łączyć się z zewnętrznymi serwerami MCP.

### Co robi

- Przyjmuje wiadomości użytkownika przez REST API
- Ładuje szablon agenta z dysku (plik `.agent.md`)
- Uruchamia **pętlę agentową**: generacja LLM → wywołanie narzędzi → kolejna generacja → ... aż do uzyskania finalnej odpowiedzi
- Obsługuje wieloturowe konwersacje z persistencją w SQLite
- Wspiera streaming odpowiedzi (SSE) i asynchroniczne dostarczanie wyników

### Jaki problem rozwiązuje

Abstrahuje różnice między providerami LLM (OpenAI, Gemini, OpenRouter) w jeden spójny interfejs. Zamiast pisać osobną integrację dla każdego API, developer definiuje agenta jako plik Markdown z system promptem i listą narzędzi — serwer zajmuje się resztą.

### Główny scenariusz użycia

```bash
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"agent":"alice","input":"What is 42 * 17?"}'
```

Użytkownik wysyła zapytanie do agenta `alice`. Serwer ładuje szablon, uruchamia pętlę agentową (alice używa narzędzia `calculator`), i zwraca wynik `714`.

### Najważniejsze elementy techniczne

- **Hono** — lekki framework HTTP z middleware
- **Multi-provider** — OpenAI Responses API, Gemini Interactions API, OpenRouter
- **Pętla agentowa** z tool calling, delegacją i limitem tur
- **MCP** (Model Context Protocol) — integracja z zewnętrznymi serwerami narzędzi
- **SQLite + Drizzle ORM** — persystencja sesji, agentów i historii konwersacji
- **Langfuse** — opcjonalne tracing/observability

---

## 2. Architektura wysokopoziomowa

System składa się z pięciu głównych warstw, przez które przepływa każdy request:

```mermaid
graph TB
    Client([Klient HTTP])

    subgraph "Warstwa HTTP"
        MW[Middleware<br/>auth, rate-limit, CORS]
        Routes[Routes<br/>chat.ts, mcp.ts]
    end

    subgraph "Warstwa logiki biznesowej"
        Service[Chat Service<br/>chat.service.ts, chat.turn.ts]
        Runner[Agent Runner<br/>runner.ts — pętla agentowa]
    end

    subgraph "Warstwa integracji"
        Providers[Providery AI<br/>OpenAI, Gemini, OpenRouter]
        Tools[Tool Registry<br/>calculator, delegate]
        MCP[MCP Manager<br/>stdio/HTTP klienty]
        Workspace[Workspace Loader<br/>szablony .agent.md]
    end

    subgraph "Warstwa persystencji"
        Repo[Repositories<br/>users, sessions, agents, items]
        DB[(SQLite)]
    end

    subgraph "Warstwa observability"
        Events[Event Emitter]
        Logger[Pino Logger]
        Langfuse[Langfuse Tracing]
    end

    Client --> MW --> Routes --> Service --> Runner
    Runner --> Providers
    Runner --> Tools
    Runner --> MCP
    Runner --> Repo
    Service --> Workspace
    Service --> Repo
    Repo --> DB
    Runner --> Events
    Events --> Logger
    Events --> Langfuse
```

**Odpowiedzialności warstw:**

| Warstwa | Co robi |
|---|---|
| **HTTP** | Walidacja requestów, autentykacja, rate limiting, routing |
| **Logika biznesowa** | Setup tury (sesja, agent, input), orchestracja pętli agentowej |
| **Integracje** | Komunikacja z LLM API, wykonywanie narzędzi, ładowanie szablonów |
| **Persystencja** | CRUD na encjach domenowych (SQLite via Drizzle) |
| **Observability** | Logowanie lifecycle, tracing do Langfuse |

---

## 3. Struktura repozytorium

Zamiast opisywać każdy folder osobno, poniżej kluczowe pliki pogrupowane według tego, **po co do nich zagląda developer**:

### Gdzie startuje aplikacja

| Plik | Co robi |
|---|---|
| `src/index.ts` | Entry point — `main()` startuje runtime i serwer HTTP |
| `src/lib/runtime.ts` | `initRuntime()` — rejestruje providerów, DB, tools, MCP |
| `src/lib/app.ts` | Konfiguracja Hono — middleware chain i routing |

### Gdzie jest główna logika

| Plik | Co robi |
|---|---|
| `src/runtime/runner.ts` | **Pętla agentowa** — `runAgent()`, `executeTurn()`, `handleTurnResponse()` |
| `src/routes/chat.service.ts` | Orchestracja: przygotowanie tury → uruchomienie runnera → formatowanie odpowiedzi |
| `src/routes/chat.turn.ts` | Setup tury — rozwiązanie szablonu, sesji, agenta |

### Gdzie są typy i model domenowy

| Plik | Co robi |
|---|---|
| `src/domain/agent.ts` | Encja `Agent` + maszyna stanów (pending→running→waiting→completed) |
| `src/domain/session.ts` | Encja `Session` — kontener konwersacji |
| `src/domain/item.ts` | Encja `Item` — polymorficzne wpisy (message, function_call, reasoning) |
| `src/domain/types.ts` | Typaliasy (ID, statusy, content) |

### Gdzie są integracje z AI

| Plik | Co robi |
|---|---|
| `src/providers/openai/adapter.ts` | Adapter OpenAI Responses API (generate + stream) |
| `src/providers/gemini/adapter.ts` | Adapter Gemini Interactions API (generate + stream) |
| `src/providers/types.ts` | Abstrakcja `Provider` — wspólny interfejs |
| `src/providers/registry.ts` | Rejestr providerów + parser `"openai:gpt-4.1"` |

### Gdzie są narzędzia i MCP

| Plik | Co robi |
|---|---|
| `src/tools/definitions/calculator.ts` | Wbudowane narzędzie: add, subtract, multiply, divide |
| `src/tools/definitions/delegate.ts` | Narzędzie delegacji do child agenta |
| `src/mcp/client.ts` | Manager klientów MCP (stdio + Streamable HTTP) |
| `src/mcp/oauth.ts` | OAuth PKCE flow dla serwerów MCP wymagających autoryzacji |

### Gdzie jest konfiguracja

| Plik | Co robi |
|---|---|
| `src/lib/config.ts` | Walidacja zmiennych środowiskowych (Zod), eksport `config` |
| `src/config/models.ts` | Definicje modeli — context window, progi pruningu |
| `.env` | Klucze API, ustawienia serwera |
| `.mcp.json` | Konfiguracja serwerów MCP |

### Gdzie jest persystencja

| Plik | Co robi |
|---|---|
| `src/repositories/sqlite/schema.ts` | Schema Drizzle — tabele `users`, `sessions`, `agents`, `items` |
| `src/repositories/sqlite/index.ts` | Implementacja CRUD + mappery DB↔Domain |
| `src/repositories/types.ts` | Interfejsy repozytoriów |

### Gdzie są szablony agentów

| Plik | Co robi |
|---|---|
| `workspace/agents/alice.agent.md` | Szablon agenta Alice — calculator, delegate, pliki MCP |
| `workspace/agents/bob.agent.md` | Szablon agenta Bob — web search specialist |
| `src/workspace/loader.ts` | Parser: frontmatter YAML + body Markdown → `LoadedAgent` |

---

## 4. Główny przepływ działania aplikacji

### Od startu serwera do gotowości

1. `src/index.ts` → `main()` → `initRuntime()`
2. Runtime rejestruje providerów AI na podstawie kluczy w `.env`
3. Tworzy połączenie z SQLite i ustawia pragmas (WAL, foreign keys)
4. Rejestruje wbudowane narzędzia (calculator, delegate)
5. Łączy się z serwerami MCP zdefiniowanymi w `.mcp.json`
6. Skanuje `workspace/agents/` po dostępne szablony
7. Tworzy event emitter i podpina subscriberów (logger, Langfuse)
8. Startuje serwer HTTP na skonfigurowanym porcie

### Od requestu do odpowiedzi

```mermaid
sequenceDiagram
    actor User
    participant API as Hono Routes
    participant Service as Chat Service
    participant WS as Workspace Loader
    participant Runner as Agent Runner
    participant LLM as Provider (OpenAI/Gemini)
    participant Tool as Tool / MCP
    participant DB as SQLite

    User->>API: POST /api/chat/completions<br/>{agent:"alice", input:"What is 42*17?"}
    API->>API: Middleware: auth, rate-limit, validation

    API->>Service: prepareChat(req)
    Service->>WS: resolveAgent("alice")<br/>czyta workspace/agents/alice.agent.md
    WS-->>Service: {model, systemPrompt, tools}
    Service->>DB: Utwórz/wznów sesję i agenta
    Service->>DB: Zapisz wiadomość użytkownika jako Item

    API->>Service: executePreparedChat()
    Service->>Runner: runAgent(agentId)

    loop Pętla agentowa (max 10 tur)
        Runner->>DB: Załaduj Items (historia konwersacji)
        Runner->>Runner: Opcjonalnie: pruning kontekstu
        Runner->>LLM: provider.generate({model, instructions, input, tools})
        LLM-->>Runner: {output: [text?, function_call?]}
        Runner->>DB: Zapisz output jako Items

        alt LLM zwrócił function_call
            Runner->>Tool: Wykonaj narzędzie (calculator/MCP/delegate)
            Tool-->>Runner: Wynik narzędzia
            Runner->>DB: Zapisz wynik jako function_call_output
            Note over Runner: Kontynuuj pętlę — następna tura
        else LLM zwrócił tylko tekst
            Note over Runner: Break — agent completed
        end
    end

    Runner-->>Service: {status:"completed", items}
    Service-->>API: ChatResponse
    API-->>User: 200 {data: {output: [{type:"text", text:"714"}]}}
```

### Co się dzieje krok po kroku

1. **Request** trafia do Hono → middleware weryfikuje Bearer token (SHA-256 hash porównywany z DB)
2. **Chat Service** ładuje szablon agenta z dysku (za każdym razem — umożliwia hot reload)
3. **Service** tworzy lub wznawia sesję i agenta w DB, zapisuje wiadomość użytkownika
4. **Runner** uruchamia pętlę agentową:
   - Ładuje historię konwersacji (Items) z DB
   - Sprawdza, czy potrzebny jest pruning (szacowanie tokenów vs okno kontekstowe modelu)
   - Wywołuje LLM przez adapter providera
   - Jeśli LLM zwrócił `function_call` → wykonuje narzędzie i wraca do kroku 1 pętli
   - Jeśli LLM zwrócił tylko tekst → pętla się kończy
5. **Odpowiedź** jest formatowana i zwracana klientowi

---

## 5. Przepływ danych

### Co wchodzi, co wychodzi

```mermaid
flowchart LR
    subgraph Input
        REQ["ChatRequest<br/>{agent, input, model?,<br/>stream?, sessionId?,<br/>tools?, temperature?}"]
    end

    subgraph "Transformacje wewnętrzne"
        TPL["Szablon agenta<br/>(model, systemPrompt, tools)"]
        AGT["Agent w DB<br/>(status, config, turnCount)"]
        ITEMS["Items w DB<br/>(messages, function_calls,<br/>function_call_outputs)"]
        PRUNED["Przycięty kontekst<br/>(po pruning/summarization)"]
        PINPUT["ProviderInput<br/>(instructions + items<br/>zmapowane na format providera)"]
        POUTPUT["ProviderOutput<br/>(text, function_call, reasoning)"]
    end

    subgraph Output
        RESP["ChatResponse<br/>{id, sessionId, status,<br/>model, output[], waitingFor?}"]
    end

    REQ --> TPL --> AGT --> ITEMS --> PRUNED --> PINPUT --> POUTPUT --> RESP
    POUTPUT -.->|function_call| ITEMS
```

### Mapowanie typów między warstwami

Dane przechodzą przez kilka transformacji typów:

| Warstwa | Typ | Przykład |
|---|---|---|
| HTTP Request | `ChatRequest` | `{agent:"alice", input:"Hello"}` |
| Domain | `Agent` + `Item[]` | Agent(status:running, config:{model, tools}) |
| Provider input | `ProviderInputItem[]` | `[{type:"message", role:"user", content:"Hello"}]` |
| OpenAI API | `ResponseInputItem[]` | `[{role:"user", content:"Hello"}]` |
| Provider output | `ProviderOutputItem[]` | `[{type:"text", text:"Hi!"}]` |
| Domain (zapis) | `Item` | `{type:"message", role:"assistant", content:"Hi!"}` |
| HTTP Response | `ChatResponse` | `{output:[{type:"text", text:"Hi!"}]}` |

Każdy adapter providera (`openai/adapter.ts`, `gemini/adapter.ts`) ma funkcje `toXxxInput()` i `fromXxxOutput()`, które mapują nasze typy wewnętrzne na format konkretnego API i odwrotnie.

---

## 6. Kluczowe moduły i komponenty

### Agent Runner (`src/runtime/runner.ts`)

**Rola:** Serce aplikacji — orchestruje pętlę agentową.

**Wejście:** `agentId` + `RuntimeContext` + opcje (maxTurns, signal, execution context)

**Wyjście:** `RunResult` — jeden z: `completed` (z Items), `waiting` (z listą oczekiwanych narzędzi), `failed`, `cancelled`

**Kluczowe funkcje:**
- `runAgent()` — główna pętla non-streaming
- `runAgentStream()` — pętla ze streamingiem SSE
- `executeTurn()` — pojedyncza tura: przygotuj input → wywołaj LLM → obsłuż response
- `handleTurnResponse()` — logika rozgałęziania po odpowiedzi LLM: sync tool / MCP tool / delegate / unknown → deferred
- `handleDelegation()` — spawning child agenta i rekurencyjne `runAgent()`
- `deliverResult()` — dostarczanie wyników do czekającego agenta + auto-propagacja do parenta
- `prepareTurnInput()` — ładowanie Items z DB, pruning, budowanie inputu dla providera

**Obsługa narzędzi (decyzja w `handleTurnResponse`):**

```
function_call od LLM
├── Tool zarejestrowany w registry (type: 'sync') → wykonaj natychmiast
├── Tool zarejestrowany w registry (type: 'agent') → handleDelegation()
├── Nazwa pasuje do MCP (zawiera '__') → mcp.callTool()
└── Nieznane narzędzie → status 'waiting', zwróć 202
```

### Adaptery providerów (`src/providers/`)

**Rola:** Tłumaczenie między wewnętrzną abstrakcją a konkretnymi API.

Każdy adapter implementuje interfejs `Provider`:

```typescript
interface Provider {
  name: string
  generate(request: ProviderRequest): Promise<ProviderResponse>
  stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent>
}
```

**OpenAI adapter** — używa `client.responses.create()` (Responses API, nie Chat Completions). Obsługuje reasoning summaries z modeli o-series.

**Gemini adapter** — używa `client.interactions.create()` (Interactions API). Obsługuje `thought` content type (thinking Gemini). Przechowuje `signature` do walidacji multi-turn.

**Multi-provider sessions:** Adaptery są zaprojektowane tak, że reasoning z jednego providera jest pomijany przy wysyłaniu do drugiego. OpenAI skipuje reasoning items, Gemini skipuje reasoning bez `signature` lub z `provider !== 'gemini'`.

### Workspace Loader (`src/workspace/loader.ts`)

**Rola:** Parsowanie plików `.agent.md` na konfigurację agenta.

**Jak działa:**
1. Czyta plik `workspace/agents/{name}.agent.md`
2. Parsuje frontmatter YAML (`gray-matter`) — wyciąga `name`, `model`, `tools`
3. Body Markdown staje się system promptem
4. Rozwiązuje nazwy narzędzi na pełne definicje (`ToolDefinition[]`):
   - `"calculator"` → tool z registry
   - `"web_search"` → natywne wyszukiwanie providera
   - `"files__fs_read"` → narzędzie z serwera MCP `files`

**Odczyt z dysku przy każdym requeście** — celowy design: edytujesz `.agent.md`, testujesz natychmiast bez restartu.

### MCP Manager (`src/mcp/client.ts`)

**Rola:** Zarządzanie połączeniami z serwerami MCP i wywoływanie ich narzędzi.

**Dwa typy transportu:**
- **Stdio** — spawning procesu dziecka (np. `npx tsx ../mcp/files-mcp/src/index.ts`)
- **Streamable HTTP** — połączenie z zdalnym serwerem, z obsługą OAuth PKCE

**Konwencja nazewnictwa:** Narzędzia MCP mają prefix `server__toolName` (np. `files__fs_read`). Runner rozpoznaje podwójny underscore i kieruje wywołanie do MCP zamiast do tool registry.

### System eventów (`src/events/`)

**Rola:** Pub/sub dla lifecycle agenta — oddzielenie logiki biznesowej od observability.

Runner emituje eventy (np. `agent.started`, `turn.completed`, `tool.called`, `generation.completed`), a subscriberzy je przetwarzają:

- **Event Logger** (`lib/event-logger.ts`) — strukturalne logi Pino
- **Langfuse Subscriber** (`lib/langfuse-subscriber.ts`) — tworzy observations w Langfuse (traces, generations, tool spans)

Każdy event niesie `EventContext` z trace ID, session ID, agent ID, depth — umożliwia korelację w distributed tracing.

### Pruning i sumaryzacja (`src/utils/pruning.ts`, `src/utils/summarization.ts`)

**Problem:** Długie konwersacje przekraczają okno kontekstowe modelu.

**Strategia:**
1. **Truncation** — duże outputy narzędzi (>10k znaków) są przycinane (zachowuje początek i koniec)
2. **Drop old turns** — jeśli nadal za dużo, usuwa najstarsze tury (zachowuje pierwszą + ostatnie N)
3. **Summarization** — opcjonalnie: wyrzucone fragmenty są streszczane przez LLM i wstawiane jako context summary

**Estymacja tokenów** — heurystyka `3.5 znaku ≈ 1 token` (celowo konserwatywna).

Progi pruningu są zdefiniowane per model w `src/config/models.ts`. Gemini z 1M oknem kontekstowym ma wyższy threshold (0.90) niż GPT z 400k (0.85).

---

## 7. Runtime i sposób uruchamiania

### Kolejność inicjalizacji

```mermaid
flowchart TD
    A[main] --> B[initRuntime]
    B --> B1[initTracing — Langfuse/OTEL]
    B --> B2[registerProviders — OpenAI, Gemini, OpenRouter]
    B --> B3[createSQLiteRepositories — DB connection + pragmas]
    B --> B4[createToolRegistry — calculator, delegate]
    B --> B5[createMcpManager — connect to MCP servers]
    B --> B6[listAgentNames — scan workspace/agents/]
    B --> B7[createEventEmitter + subscribers]
    B --> B8["createContext → RuntimeContext"]
    A --> C["serve(app) — start HTTP server"]
    A --> D[Register SIGINT/SIGTERM handlers]
```

### RuntimeContext — centralny obiekt

Cały runtime jest enkapsulowany w jednym obiekcie `RuntimeContext`:

```typescript
interface RuntimeContext {
  events: AgentEventEmitter    // pub/sub
  repositories: Repositories   // users, sessions, agents, items
  tools: ToolRegistry          // calculator, delegate
  mcp: McpManager              // MCP server connections
}
```

Jest tworzony raz przy starcie i wstrzykiwany do każdego requestu przez middleware `injectRuntime`.

### Lifecycle agenta

Agent przechodzi przez stany:

```
pending → running → completed
                  → failed
                  → cancelled
                  → waiting → (deliver) → running → ...
```

Tranzycje są zaimplementowane jako czyste funkcje w `src/domain/agent.ts` (immutable — zwracają nowy obiekt `Agent`). Runner zapisuje każdą zmianę do DB.

### Graceful shutdown

`SIGINT`/`SIGTERM` → stop accepting connections → drain in-flight requests → zamknij MCP klientów → flush Langfuse → exit. Hard deadline: `SHUTDOWN_TIMEOUT_MS` (default 10s).

---

## 8. Konfiguracja i środowisko

### Zmienne środowiskowe

Walidowane przez Zod w `src/lib/config.ts`. Plik `.env` jest ładowany z dwóch lokalizacji — projektowy `.env` ma priorytet nad root `.env`.

**Klucze API (wymagany minimum jeden):**

| Zmienna | Opis |
|---|---|
| `OPENAI_API_KEY` | Klucz OpenAI |
| `GEMINI_API_KEY` | Klucz Google Gemini |
| `OPENROUTER_API_KEY` | Klucz OpenRouter |

**Serwer:**

| Zmienna | Default | Opis |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `HOST` | `127.0.0.1` | Adres bindowania |
| `CORS_ORIGIN` | `*` | Dozwolone originy (w production `*` jest zablokowane) |
| `BODY_LIMIT` | `1048576` | Max body w bajtach (1MB) |
| `TIMEOUT_MS` | `60000` | Timeout requestu |
| `RATE_LIMIT_RPM` | `60` | Rate limit per user/minutę |

**Baza danych:**

| Zmienna | Default | Opis |
|---|---|---|
| `DATABASE_URL` | `file:.data/agent.db` | Ścieżka SQLite |
| `DATABASE_AUTH_TOKEN` | — | Token LibSQL (Turso) |

**Agent:**

| Zmienna | Default | Opis |
|---|---|---|
| `WORKSPACE_PATH` | `./workspace` | Folder szablonów agentów |
| `AGENT_MAX_TURNS` | `10` | Maks. tur w pętli agentowej |
| `DEFAULT_MODEL` | `{provider}:gpt-5.4` | Domyślny model (`provider:model`) |

**Observability (opcjonalne):**

| Zmienna | Opis |
|---|---|
| `LANGFUSE_PUBLIC_KEY` | Klucz publiczny Langfuse |
| `LANGFUSE_SECRET_KEY` | Klucz sekretny Langfuse |
| `LANGFUSE_BASE_URL` | URL API Langfuse |

### Konfiguracja MCP (`.mcp.json`)

```json
{
  "mcpServers": {
    "files": {
      "transport": "stdio",
      "command": "npx",
      "args": ["tsx", "../mcp/files-mcp/src/index.ts"],
      "env": { "FS_ROOT": "./workspace" }
    },
    "remote": {
      "transport": "http",
      "url": "https://mcp-server.example.com/mcp"
    }
  }
}
```

### Konfiguracja modeli (`src/config/models.ts`)

Definiuje per-model: context window, max output tokens, progi pruningu. Nieznane modele dostają konserwatywne defaults (128k context, threshold 0.85).

---

## 9. Jak uruchomić projekt

### Wymagania

- Node.js (wersja wspierająca `process.loadEnvFile` — Node 20.12+)
- npm

### Instalacja i konfiguracja

```bash
cd 01_05_agent
npm install

# Skopiuj/utwórz plik .env i uzupełnij klucze API
# Wymagany co najmniej jeden z: OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
```

### Przygotowanie bazy danych

```bash
npm run db:push    # Tworzy tabele SQLite
npm run db:seed    # Tworzy użytkownika alice@aidevs.pl z domyślnym API key
```

### Uruchomienie

```bash
npm run dev        # Dev z hot reload (tsx watch)
npm run start      # Produkcyjne uruchomienie
npm run build      # Kompilacja TypeScript do dist/
```

### Weryfikacja

```bash
# Health check
curl -s http://127.0.0.1:3000/health | jq
# Oczekiwany wynik: {"status":"ok","checks":{"runtime":true,"db":true}}

# Test z agentem
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"alice","input":"What is 2+2?"}' | jq
```

### Zarządzanie bazą danych

```bash
npm run db:studio     # Drizzle Studio — GUI do przeglądania DB
npm run db:generate   # Generuje migracje z schematu
npm run db:migrate    # Uruchamia migracje
```

### Testy

**Założenie:** Brak testów w repozytorium — w `package.json` nie ma skryptu `test`.

---

## 10. Jak używać rozwiązania

### Podstawowa konwersacja z agentem

```bash
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"alice","input":"Calculate 42 * 17 and explain the result"}'
```

**Odpowiedź (200):**
```json
{
  "data": {
    "id": "agent-uuid",
    "sessionId": "session-uuid",
    "status": "completed",
    "model": "gemini:gemini-3-flash-preview",
    "output": [
      {"type": "text", "text": "42 × 17 = 714. This is because..."}
    ]
  },
  "error": null
}
```

### Multi-turn konwersacja

Pierwszy request zwraca `sessionId`. Kolejne requesty z tym samym `sessionId` kontynuują rozmowę z pełną historią:

```bash
# Tura 1 — zapamiętaj
SESSION=$(curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"alice","input":"Remember: my name is Adam"}' | jq -r '.data.sessionId')

# Tura 2 — kontynuuj (agent pamięta kontekst)
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d "{\"agent\":\"alice\",\"sessionId\":\"$SESSION\",\"input\":\"What is my name?\"}"
```

### Streaming (SSE)

```bash
curl -N http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"alice","input":"Tell me a story","stream":true}'
```

Zwraca Server-Sent Events: `text_delta`, `text_done`, `function_call_done`, `done`, `error`.

### Użycie konkretnego modelu (bez szablonu agenta)

```bash
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai:gpt-4.1-mini","input":"Say hello"}'
```

### Tworzenie własnego agenta

Utwórz plik `workspace/agents/myagent.agent.md`:

```markdown
---
name: myagent
model: openai:gpt-4.1
tools:
  - calculator
  - web_search
---

You are a helpful assistant specialized in data analysis.

## Guidelines

1. Always verify calculations with the calculator tool.
2. Use web search for current data.
```

Od razu działa bez restartu serwera:

```bash
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"myagent","input":"What is the GDP of Poland?"}'
```

### Asynchroniczne narzędzia (deliver)

Gdy agent używa narzędzia, którego nie ma w registry ani w MCP, zwraca status `waiting` (HTTP 202). Zewnętrzny system może dostarczyć wynik:

```bash
# Agent czeka na wynik narzędzia "custom_tool" z callId "xyz"
curl -s http://127.0.0.1:3000/api/chat/agents/<agentId>/deliver \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"callId":"xyz","output":"{\"result\":\"42\"}","isError":false}'
```

Po deliver agent wznawia pętlę i kontynuuje generację.

---

## 11. Ważne decyzje architektoniczne

### Podział odpowiedzialności

- **Domain layer jest czysto funkcyjny** — `agent.ts` operuje na immutable obiektach, zwracając `{ ok: true, agent }` lub `{ ok: false, error }`. Żadnych side effectów, żadnego DB. To runner zapisuje zmiany.
- **Runner jest jedynym orchestratorem** — cała logika decyzyjna (jaki tool? delegacja? waiting?) jest w jednym module `runner.ts`.
- **Providery są za abstrakcją** — reszta systemu nie wie, czy rozmawia z OpenAI czy Gemini. Format `"provider:model"` jest parsowany raz w `resolveProvider()`.

### Widoczne wzorce

| Wzorzec | Gdzie |
|---|---|
| **Repository Pattern** | `repositories/types.ts` — interfejsy, `sqlite/index.ts` — implementacja |
| **Adapter Pattern** | `providers/openai/adapter.ts`, `providers/gemini/adapter.ts` |
| **Registry Pattern** | `providers/registry.ts`, `tools/registry.ts` |
| **Event-Driven** | `events/emitter.ts` — pub/sub oddzielający logikę od observability |
| **State Machine** | `domain/agent.ts` — explicite tranzycje stanów |
| **Template Pattern** | `workspace/agents/*.agent.md` — deklaratywna definicja agentów |

### Mocne strony

- **Hot reload szablonów** — edytujesz `.agent.md`, testujesz natychmiast
- **Multi-provider z jednym API** — zmiana modelu to zmiana jednego stringa
- **Hierarchia agentów** — Alice deleguje do Boba, Bob deleguje do Charliego (max depth 5)
- **Asynchroniczny deliver** — agent może czekać na wynik od zewnętrznego systemu
- **Context pruning** — długie konwersacje nie crashują, kontekst jest inteligentnie przycinany
- **Czysta domena** — model domenowy nie zależy od frameworka ani bazy danych

### Kompromisy

- **Runner.ts jest monolityczny (~1000 linii)** — cała logika pętli agentowej w jednym pliku. Trudniejsze do testowania jednostkowego, ale łatwiejsze do śledzenia flow.
- **Brak cache szablonów** — odczyt z dysku przy każdym requeście. Świadomy wybór (hot reload) kosztem wydajności.
- **Singleton runtime** — `let runtime` na poziomie modułu. Prostsze niż DI container, ale utrudnia testowanie i multi-tenant.
- **SQLite jako jedyny storage** — prosta konfiguracja, ale ograniczona skalowalność (brak horizontal scaling).

---

## 12. Ryzyka, luki i trudniejsze miejsca

### Złożoność runnera

`runner.ts` zawiera: pętlę agentową, obsługę narzędzi (4 ścieżki), delegację z rekurencją, streaming, deliver z auto-propagacją. Debugowanie flow, w którym Alice deleguje do Boba, który czeka na external tool, a potem wynik propaguje się w górę — wymaga śledzenia wielu zagnieżdżonych wywołań.

### Brak testów

Żadnych testów w repozytorium. Przy złożoności maszyny stanów agenta i logiki pruningu/delegacji, to istotne ryzyko regresji.

### Potencjalne race condition w sekwencjach

`ItemRepository.create()` używa `SELECT MAX(sequence) + INSERT` do generowania numeru sekwencji. Przy współbieżnych requestach na tego samego agenta mogą wystąpić kolizje. SQLite w trybie WAL + single-writer ogranicza to ryzyko, ale nie eliminuje go całkowicie.

### Default model

Config eksportuje `defaultModel` jako `${defaultProvider}:gpt-5.4`. Jeśli ten model nie istnieje u providera (lub jest to placeholder), requesty bez jawnego `model` będą failować. **Założenie:** to celowe ustawienie dla konkretnego środowiska deweloperskiego.

### Memory repository nieużywany

`src/repositories/memory.ts` istnieje, ale nigdzie nie jest importowany w kodzie inicjalizacyjnym. **Założenie:** to alternatywa do testów lub dev bez DB, ale nie jest aktywowana.

### OAuth token storage

Tokeny OAuth MCP są przechowywane w pliku `.mcp.oauth.json` z prostym file-based lock (chain of Promises). W scenariuszu wielu procesów mogą wystąpić race conditions na zapisie.

---

## 13. Szybki przewodnik po kodzie

### „Chcę zrozumieć, jak startuje aplikacja"

→ `src/index.ts` (bootstrap) → `src/lib/runtime.ts` (`initRuntime()` — co jest inicjalizowane i w jakiej kolejności) → `src/lib/app.ts` (middleware chain)

### „Chcę zmienić logikę główną — jak agent przetwarza wiadomość"

→ `src/runtime/runner.ts` — zacznij od `runAgent()`, potem `executeTurn()`, potem `handleTurnResponse()`. To tutaj decyduje się, czy kontynuować pętlę, czekać, czy zakończyć.

### „Chcę dodać nowe narzędzie"

→ Skopiuj `src/tools/definitions/calculator.ts`, zaimplementuj interfejs `Tool` (definition + handler), zarejestruj w `src/lib/runtime.ts` przez `tools.register()`. Dodaj nazwę do szablonu agenta w `.agent.md`.

### „Chcę dodać nowego providera AI"

→ Zaimplementuj interfejs `Provider` z `src/providers/types.ts` (metody `generate` i `stream`). Zarejestruj w `src/lib/runtime.ts` przez `registerProvider()`. Format: `"myprovider:model-name"`.

### „Chcę zmienić, jak definiuje się agentów"

→ `src/workspace/loader.ts` — tu jest parsowanie frontmatter i rozwiązywanie narzędzi. Frontmatter → `AgentTemplate` → `LoadedAgent`.

### „Chcę debugować problem z wywołaniem narzędzia"

→ `src/runtime/runner.ts`, funkcja `handleTurnResponse()` — to tutaj router decyduje: sync tool / MCP tool / delegate / deferred. Logi z prefixem `runner` w konsoli.

### „Chcę debugować problem z konkretnymi API (OpenAI/Gemini)"

→ `src/providers/openai/adapter.ts` lub `src/providers/gemini/adapter.ts` — tu jest mapowanie typów. Sprawdź `toOpenAIInput()`/`fromOpenAIOutput()` lub ich odpowiedniki Gemini.

### „Chcę zrozumieć konfigurację"

→ `src/lib/config.ts` — cała walidacja zmiennych środowiskowych. `src/config/models.ts` — definicje modeli z progami pruningu.

### „Chcę zrozumieć schemat bazy danych"

→ `src/repositories/sqlite/schema.ts` — tabele Drizzle. `src/repositories/types.ts` — interfejsy repozytoriów. `src/repositories/sqlite/index.ts` — mappery DB↔Domain.

### „Chcę dodać endpoint API"

→ Utwórz route w `src/routes/`, zarejestruj w `src/routes/index.ts`, użyj `c.get('runtime')` do dostępu do runtime context.

---

## 14. Najważniejsze pliki do przeczytania

Jeśli masz ograniczony czas, te pliki dadzą Ci 80% zrozumienia projektu:

| # | Plik | Po co czytać |
|---|---|---|
| 1 | `src/runtime/runner.ts` | **Serce aplikacji.** Pętla agentowa, obsługa narzędzi, delegacja, streaming. Przeczytaj `runAgent()` i `handleTurnResponse()` — reszta wynika z nich. |
| 2 | `src/lib/runtime.ts` | **Bootstrap.** Jak wszystkie moduły są inicjalizowane i połączone. Daje pełen obraz zależności. |
| 3 | `src/domain/agent.ts` | **Model domenowy.** Maszyna stanów agenta — jakie tranzycje są możliwe, jak wyglądają immutable operacje. |
| 4 | `src/providers/types.ts` | **Abstrakcja providera.** Interfejs `Provider`, typy request/response, stream events. Kontrakt dla całej warstwy AI. |
| 5 | `src/routes/chat.turn.ts` | **Most HTTP↔Runtime.** Jak request HTTP jest mapowany na sesję, agenta i Items w DB. |
| 6 | `src/workspace/loader.ts` | **Szablony agentów.** Jak pliki `.agent.md` stają się konfiguracją runtime. |
| 7 | `src/providers/openai/adapter.ts` | **Wzorcowy adapter.** Jak wygląda implementacja providera — mapowanie typów, obsługa streaming. |
| 8 | `src/mcp/client.ts` | **MCP integracja.** Jak serwer łączy się z zewnętrznymi narzędziami, OAuth flow, stdio vs HTTP. |
| 9 | `src/utils/pruning.ts` | **Zarządzanie kontekstem.** Jak system radzi sobie z długimi konwersacjami — truncation, drop turns, summarization. |
| 10 | `src/lib/config.ts` | **Konfiguracja.** Wszystkie zmienne środowiskowe, walidacja, defaults. Pierwszy plik do sprawdzenia przy problemach z uruchomieniem. |

# Analiza techniczna projektu TypeScript
_Exported on 4/7/2026 at 16:26:19 CDT from Cursor (3.0.12)_

---

**User**

Twoim zadaniem jest najpierw przeanalizować całe repozytorium projektu TypeScript i zrozumieć, jak działa aplikacja.

Na tym etapie NIE twórz jeszcze finalnego dokumentu.
Najpierw wykonaj analizę techniczną projektu.

Odpowiadaj po polsku.

Zasady:
- bazuj na realnym kodzie i strukturze repozytorium,
- nie zgaduj bez potrzeby,
- jeśli czegoś nie da się potwierdzić w kodzie, oznacz to jako „Założenie”,
- skup się na zrozumieniu projektu z perspektywy osoby technicznej.

Przeanalizuj repozytorium i opisz:

# 1. Cel projektu
- co prawdopodobnie robi aplikacja,
- jaki problem rozwiązuje,
- jaki jest jej główny scenariusz użycia.

# 2. Punkty wejścia
- gdzie startuje aplikacja,
- jakie są główne entry pointy,
- jaki plik lub moduł uruchamia całość,
- jak wygląda bootstrap aplikacji.

# 3. Struktura repozytorium
- najważniejsze foldery i pliki,
- rola każdego kluczowego folderu,
- gdzie znajduje się główna logika aplikacji,
- gdzie są helpery, utils, typy, serwisy, komponenty, konfiguracja itp.

# 4. Stack technologiczny
- jakie frameworki i biblioteki są używane,
- co wynika z package.json, tsconfig, configów, skryptów npm,
- czy jest frontend, backend, CLI, biblioteka, fullstack albo inny typ aplikacji.

# 5. Główny przepływ działania
- co dzieje się od startu aplikacji do uzyskania wyniku,
- jak przepływają dane między modułami,
- jakie komponenty biorą udział w głównym flow.

# 6. Moduły i odpowiedzialności
- jakie są najważniejsze moduły,
- za co odpowiada każdy z nich,
- jak komunikują się między sobą.

# 7. Konfiguracja projektu
- gdzie są ustawienia i konfiguracje,
- jak działa .env, config, zmienne środowiskowe, jeśli występują,
- które ustawienia wydają się najważniejsze.

# 8. Jak uruchamiany jest projekt
- jakie komendy są dostępne,
- jak działa npm/yarn/pnpm scripts,
- jak wygląda uruchamianie w dev/build/test.

# 9. Jak używać rozwiązania
- jak użytkownik lub developer uruchamia główny scenariusz,
- jakie są wejścia i wyjścia,
- jak praktycznie korzysta się z tego solution.

# 10. Najważniejsze miejsca do zrozumienia projektu
- wskaż 5–10 najważniejszych plików lub modułów,
- wyjaśnij krótko, dlaczego są ważne.

# 11. Ryzyka, niejasności i trudne miejsca
- co jest mało czytelne,
- gdzie architektura może być zbyt mocno spięta,
- co może być trudne do debugowania,
- jakie są potencjalne słabe punkty.

Na końcu dodaj krótkie podsumowanie:
1. „Jak dobrze rozumiem ten projekt w skali 1–10”
2. „Jakie informacje są już jasne”
3. „Jakie rzeczy wymagają jeszcze doprecyzowania z kodu”

Ważne:
- nie twórz jeszcze dokumentu Markdown,
- nie twórz jeszcze diagramów Mermaid,
- na tym etapie skup się tylko na analizie.

---

**Cursor**

Zaczynam dogłębną analizę repozytorium. Uruchomię kilka równoległych eksploracji, żeby pokryć całą strukturę projektu.

Świetnie, mam już ogólny obraz. Teraz czytam kluczowe pliki źródłowe.

Teraz czytam moduły routingu, domeny, providerów, narzędzi i pozostałe kluczowe pliki.

Teraz czytam moduły providerów, narzędzi, MCP, workspace i repozytoriów.

Czytam pozostałe kluczowe pliki — narzędzia, middleware, repozytoria, eventy i konfiguracja modeli.

Ostatnia porcja — repozytoria, typy domenowe, pruning, tracing i pliki workspace.

Mam już pełny obraz. Oto moja szczegółowa analiza techniczna projektu.

---

# Analiza techniczna: `01_05_agent`

## 1. Cel projektu

Aplikacja to **serwer AI agentowy** (backend API), który umożliwia:
- Wysyłanie wiadomości do zdefiniowanych „agentów" AI i uzyskiwanie odpowiedzi
- Definiowanie agentów jako plików Markdown z fronmatterem (szablony agentów)
- Wykonywanie narzędzi (tool calling) — zarówno wbudowanych, jak i z serwerów MCP
- Delegowanie zadań między agentami (hierarchia parent → child)
- Wieloturowe konwersacje z obsługą sesji
- Streaming odpowiedzi przez SSE
- Asynchroniczne dostarczanie wyników do „czekających" agentów

**Problem, który rozwiązuje:** Udostępnia ujednolicone API do interakcji z wieloma providerami LLM (OpenAI, Gemini, OpenRouter), z wbudowanym systemem narzędzi, integracją MCP i obsługą hierarchicznych agentów — wszystko opakowane w jeden serwer HTTP.

**Główny scenariusz użycia:** Użytkownik wysyła `POST /api/chat/completions` z nazwą agenta i treścią wiadomości, serwer ładuje szablon agenta z dysku, uruchamia pętlę agentową (generacja → wywołanie narzędzi → kolejna generacja → ...) i zwraca wynik.

## 2. Punkty wejścia

- **Główny entry point:** `src/index.ts` — uruchamia `main()`, która:
  1. Wywołuje `initRuntime()` — rejestracja providerów, baza danych, tool registry, MCP, workspace
  2. Startuje serwer HTTP Hono na `@hono/node-server`
  3. Rejestruje handlery SIGINT/SIGTERM dla graceful shutdown

- **Drugorzędny entry point:** `src/db/seed.ts` — osobny skrypt do seedowania bazy danych

- **Bootstrap flow:**
  `main()` → `initRuntime()` → rejestracja providerów AI → tworzenie SQLite repositories → rejestracja narzędzi (calculator, delegate) → inicjalizacja MCP klientów → ładowanie listy szablonów agentów → tworzenie event emittera i subscriberów → uruchomienie serwera HTTP

## 3. Struktura repozytorium

| Folder/Plik | Rola |
|---|---|
| `src/index.ts` | Entry point — bootstrap serwera |
| `src/lib/app.ts` | Konfiguracja Hono (middleware, routing) |
| `src/lib/config.ts` | Walidacja i eksport zmiennych środowiskowych (Zod) |
| `src/lib/runtime.ts` | Inicjalizacja runtime (providery, DB, tools, MCP) |
| `src/lib/tracing.ts` | Integracja Langfuse via OpenTelemetry |
| `src/lib/langfuse-subscriber.ts` | Subscriber eventów → Langfuse observations |
| `src/lib/event-logger.ts` | Subscriber eventów → logi Pino |
| `src/routes/` | Endpointy HTTP (chat, MCP) |
| `src/routes/chat.ts` | Handler POST /api/chat/completions i deliver |
| `src/routes/chat.service.ts` | Logika biznesowa chatu |
| `src/routes/chat.turn.ts` | Przygotowanie tury — sesja, agent, input |
| `src/routes/chat.schema.ts` | Walidacja requestów (Zod) |
| `src/routes/chat.response.ts` | Formatowanie odpowiedzi |
| `src/routes/mcp.ts` | OAuth flow i listing serwerów MCP |
| `src/runtime/runner.ts` | **Serce aplikacji** — pętla agentowa, obsługa narzędzi, delegacja |
| `src/runtime/context.ts` | Typy kontekstu runtime i execution |
| `src/domain/` | Encje domenowe (Agent, Session, Item) + maszyna stanów |
| `src/domain/agent.ts` | Agent + tranzycje stanów (pending→running→waiting→completed) |
| `src/domain/session.ts` | Sesja konwersacyjna |
| `src/domain/item.ts` | Polymorficzne wpisy konwersacji |
| `src/domain/types.ts` | Typaliasy (ID, statusy, content) |
| `src/providers/` | Adaptery providerów AI |
| `src/providers/registry.ts` | Rejestr providerów + parser `provider:model` |
| `src/providers/openai/adapter.ts` | Adapter OpenAI Responses API |
| `src/providers/gemini/adapter.ts` | Adapter Gemini Interactions API |
| `src/providers/types.ts` | Typy abstrakcji providera |
| `src/tools/` | Rejestr i definicje narzędzi |
| `src/tools/definitions/calculator.ts` | Tool: kalkulator (add/sub/mul/div) |
| `src/tools/definitions/delegate.ts` | Tool: delegacja do child agenta |
| `src/mcp/client.ts` | Manager klientów MCP (stdio + HTTP) |
| `src/mcp/oauth.ts` | OAuth provider dla MCP serwerów HTTP |
| `src/workspace/loader.ts` | Ładowanie szablonów agentów z Markdown |
| `src/repositories/` | Warstwa persystencji |
| `src/repositories/sqlite/` | Implementacja SQLite z Drizzle ORM |
| `src/repositories/memory.ts` | Implementacja in-memory (bez DB) |
| `src/middleware/auth.ts` | Bearer token auth (SHA-256 hash) |
| `src/middleware/rate-limit.ts` | Rate limiter |
| `src/config/models.ts` | Definicje modeli (context window, pruning) |
| `src/utils/pruning.ts` | Przycinanie kontekstu konwersacji |
| `src/utils/summarization.ts` | Sumaryzacja LLM wyrzuconych fragmentów |
| `src/events/` | System eventów (emitter + typy) |
| `workspace/agents/` | Szablony agentów (.agent.md) |

## 4. Stack technologiczny

**Typ aplikacji:** Backend API server (Node.js)

**Framework HTTP:** Hono (lekki, wydajny) + `@hono/node-server`

**Providery AI:**
- OpenAI SDK (`openai` v6) — Responses API
- Google Gemini SDK (`@google/genai`) — Interactions API
- OpenRouter (przez adapter OpenAI z custom baseUrl)

**Baza danych:** SQLite via `@libsql/client` + `drizzle-orm`

**MCP:** `@modelcontextprotocol/sdk` — Client (stdio + Streamable HTTP)

**Walidacja:** `zod` v4

**Logging:** `pino` + `pino-pretty`

**Observability:** Langfuse (`@langfuse/otel`, `@langfuse/tracing`) + OpenTelemetry

**Parsowanie Markdown:** `gray-matter` (frontmatter)

**Runtime:** `tsx` (TypeScript execution), ESM modules

**Skrypty npm:**
- `dev` — `tsx watch src/index.ts` (hot reload)
- `start` — `tsx src/index.ts`
- `build` — `tsc` (kompilacja do JS)
- `db:push/migrate/generate/seed/studio` — zarządzanie bazą danych

## 5. Główny przepływ działania

**Request → Response flow:**

1. **HTTP Request** → `POST /api/chat/completions` z `{ agent: "alice", input: "What is 42 * 17?" }`
2. **Middleware chain:** requestId → logging → secureHeaders → CORS → bodyLimit → timeout → injectRuntime → bearerAuth → rateLimiter
3. **Route handler** (`chat.ts`) → walidacja Zod → `prepareChat()`
4. **`setupChatTurn()`** (`chat.turn.ts`):
   - Ładuje szablon agenta z `workspace/agents/alice.agent.md` (czyta z dysku za każdym razem)
   - Rozwiązuje konfigurację (model, tools, instructions)
   - Tworzy/wznawia sesję i agenta w DB
   - Zapisuje wiadomość użytkownika jako Item
5. **`runAgent()`** (`runner.ts`) — **pętla agentowa**:
   - Zmienia status agenta na `running`
   - **Loop (max 10 tur):**
     - `prepareTurnInput()` — ładuje Items z DB, opcjonalnie pruning kontekstu
     - `provider.generate()` — wywołanie LLM
     - `handleTurnResponse()` — zapisuje output, przetwarza function_calls:
       - **Sync tool** (np. calculator) → wykonanie natychmiast, zapis wyniku
       - **MCP tool** (np. `files__fs_read`) → wywołanie przez MCP klienta
       - **Agent tool** (delegate) → spawning child agenta, rekurencyjne `runAgent()`
       - **Nieznane narzędzie** → status `waiting`, zwrócenie 202
     - Jeśli brak function_calls → agent completed, break
     - Jeśli są sync tools i wyniki → kontynuacja pętli (następna tura)
6. **Odpowiedź** — `toChatResponse()` formatuje Items do outputu API

**Delegacja agentów:**
- Alice może delegować do Boba: `delegate({ agent: "bob", task: "Research X" })`
- Bob jest spawned jako child agent, uruchamiany rekurencyjnie
- Po zakończeniu Boba, wynik wraca do Alice, pętla kontynuuje
- Maksymalna głębokość hierarchii: 5

## 6. Moduły i odpowiedzialności

| Moduł | Odpowiedzialność | Komunikacja |
|---|---|---|
| **Runtime (runner.ts)** | Pętla agentowa, orchestracja | Centralny — łączy wszystko |
| **Providers** | Abstrakcja nad LLM API | Runner → Provider.generate/stream |
| **Tools** | Rejestr + wykonanie narzędzi | Runner → ToolRegistry.execute |
| **MCP** | Klienty serwerów MCP | Runner → McpManager.callTool |
| **Domain** | Encje i logika biznesowa | Czyste funktory, immutable |
| **Repositories** | Persystencja (CRUD) | Runner/Service → Repositories |
| **Workspace** | Ładowanie szablonów agentów | Service → loader → plik .agent.md |
| **Routes** | HTTP warstwa, walidacja | HTTP → Service → Runner |
| **Events** | Pub/sub dla lifecycle | Runner emituje → Logger/Langfuse subskrybują |
| **Config** | Centralna konfiguracja | Używany przez wszystkie moduły |
| **Middleware** | Auth, rate limiting | Hono middleware chain |

**Komunikacja:** Moduły komunikują się głównie przez:
- Dependency injection via `RuntimeContext` (events, repositories, tools, mcp)
- Event emitter (pub/sub) dla observability
- Bezpośrednie importy dla konfiguracji i helperów

## 7. Konfiguracja projektu

**Plik `.env`** — główne źródło konfiguracji, walidowane przez Zod w `src/lib/config.ts`.

**Najważniejsze zmienne:**
- `OPENAI_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` — klucze do providerów (wymagany min. jeden)
- `AUTH_TOKEN` — *Uwaga: w kodzie nie ma `AUTH_TOKEN`* — autentykacja opiera się o `SEED_API_KEY` i hash w DB
- `DATABASE_URL` — ścieżka do SQLite (`file:.data/agent.db`)
- `WORKSPACE_PATH` — ścieżka do szablonów agentów (`./workspace`)
- `AGENT_MAX_TURNS` — limit tur pętli agentowej (default: 10)
- `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` — opcjonalne tracing

**`.mcp.json`** — konfiguracja serwerów MCP (stdio i HTTP).

**Hierarchia .env:** `<projekt>/.env` ma priorytet nad `<root>/.env` (nie nadpisuje już ustawionych zmiennych).

**Zabezpieczenie produkcyjne:** `CORS_ORIGIN=*` jest zablokowane w production.

## 8. Jak uruchamiany jest projekt

```bash
npm install            # Instalacja zależności
cp .env.example .env   # Konfiguracja zmiennych
npm run db:push        # Tworzenie tabel SQLite
npm run db:seed        # Seedowanie użytkownika (alice@aidevs.pl)
npm run dev            # Serwer dev z hot reload (tsx watch)
npm run start          # Produkcyjne uruchomienie
npm run build          # Kompilacja TypeScript → dist/
npm run db:studio      # Drizzle Studio (GUI dla DB)
```

Brak testów w package.json — **Założenie**: testy nie zostały jeszcze zaimplementowane.

## 9. Jak używać rozwiązania

**Główny scenariusz — rozmowa z agentem:**

```bash
curl -s http://127.0.0.1:3000/api/chat/completions \
  -H "Authorization: Bearer 0f47acce-3aa7-4b58-9389-21b2940ecc70" \
  -H "Content-Type: application/json" \
  -d '{"agent":"alice","input":"What is 42 * 17?"}'
```

**Wejścia:**
- `agent` — nazwa szablonu (np. "alice")
- `input` — treść wiadomości (string lub structured items)
- opcjonalnie: `model`, `stream`, `sessionId`, `temperature`, `tools`, `instructions`

**Wyjścia:**
- JSON z `data.output` (tablica: text i/lub function_call)
- `data.sessionId` — do kontynuacji konwersacji
- `data.status` — `completed` (200) lub `waiting` (202)

**Multi-turn:** Pierwszy request zwraca `sessionId`, kolejne requesty z tym `sessionId` kontynuują rozmowę.

**Streaming:** `"stream": true` → odpowiedź jako Server-Sent Events.

**Deliver (async tools):** Gdy agent czeka (`waiting`), wysyłamy wynik narzędzia przez `POST /api/chat/agents/:agentId/deliver`.

## 10. Najważniejsze pliki do zrozumienia

1. **`src/runtime/runner.ts`** (~996 linii) — **Najważniejszy plik.** Pętla agentowa, orchestracja tur, obsługa narzędzi, delegacja, streaming. Każda ścieżka decyzyjna przepływu danych przechodzi przez ten plik.

2. **`src/lib/runtime.ts`** — Bootstrap całego runtime. Pokazuje, jak wszystkie moduły są inicjalizowane i połączone.

3. **`src/domain/agent.ts`** — Maszyna stanów agenta (pending → running → waiting/completed/failed). Kluczowe tranzycje definiujące cykl życia.

4. **`src/providers/types.ts`** — Abstrakcja providera. Definiuje kontrakt, który muszą spełniać adaptery OpenAI/Gemini.

5. **`src/routes/chat.turn.ts`** — Setup tury — jak request HTTP mapuje się na agenta, sesję i Items. Most między warstwą HTTP a runtime.

6. **`src/workspace/loader.ts`** — Ładowanie szablonów agentów z Markdown. Klucz do zrozumienia, jak agenci są definiowani.

7. **`src/providers/openai/adapter.ts`** — Wzorcowa implementacja adaptera providera. Pokazuje mapowanie typów.

8. **`src/mcp/client.ts`** — Manager MCP. Obsługuje stdio/HTTP transporty, OAuth, tool calling.

9. **`src/config/models.ts`** — Definicje modeli z oknem kontekstowym i progami pruningu. Wpływa na zachowanie long-running konwersacji.

10. **`src/utils/pruning.ts`** — Inteligentne przycinanie kontekstu (truncation, drop old turns, zachowanie recent). Krytyczne dla stabilności długich sesji.

## 11. Ryzyka, niejasności i trudne miejsca

### Złożoność
- **`runner.ts`** to ~1000 linii w jednym pliku z wieloma zagnieżdżonymi ścieżkami (sync tool, MCP tool, agent tool, unknown tool, streaming vs non-streaming). Trudny do debugowania i modyfikacji.
- **Rekurencja delegacji** (`runAgent` → `handleDelegation` → `runAgent`) z auto-propagacją wyników w `deliverResult` — głęboki call stack, potencjalnie trudny do śledzenia.

### Potencjalne problemy
- **Brak testów** — brak jakichkolwiek testów w repozytorium. Ryzykowne przy tak złożonej logice stanowej.
- **Brak transakcyjności** — `createItemRepo.create()` używa `SELECT MAX + INSERT` do generowania sequence, co przy współbieżnych requestach może dać kolizje (choć SQLite w trybie WAL zmniejsza to ryzyko).
- **Szablony agentów czytane z dysku przy każdym requeście** — brak cache, potencjalny bottleneck przy dużym ruchu (choć design zamierzony — hot reload).
- **Model `gpt-5.4` w default config** — **Założenie**: to przyszły lub testowy model; jeśli nie istnieje u providera, requesty bez jawnego modelu będą failować.

### Niejasności
- **`src/repositories/memory.ts`** istnieje, ale nie jest nigdzie używany w kodzie inicjalizacyjnym — **Założenie**: to alternatywa dev/test, ale nie jest aktywowana.
- **Rate limiter** — plik `rate-limit.ts` istnieje (eksportowany z middleware/index.ts), ale nie udało mi się go przeczytać. Jego implementacja jest nieznana.
- **Brak `.env.example`** — README wspomina `cp .env.example .env`, ale nie wiadomo, czy plik istnieje.
- **Pole `traceId` na agencie** vs `traceId` w `ExecutionContext` — dwie ścieżki ustawiania trace ID, co może powodować rozbieżności.

### Tight coupling
- `runner.ts` importuje `getAgent` z `lib/runtime.ts`, który z kolei importuje moduły z `workspace/` — circular-ish dependency chain.
- `RuntimeContext` jest singletonem modułowym (`let runtime`), co utrudnia testowanie i izolację.

### Trudności debugowania
- Asynchroniczna pętla z wieloma await-ami wewnątrz runner.ts, gdzie stan agenta mutuje się w DB między krokami — trudno odtworzyć dokładny stan przy awarii.
- Event-driven observability (Langfuse) dodaje dodatkową warstwę side-effectów, które mogą maskować lub komplikować debugging.

---

## Podsumowanie

1. **Jak dobrze rozumiem ten projekt:** **9/10** — Przeanalizowałem praktycznie każdy plik źródłowy. Jedyne luki to: implementacja `rate-limit.ts` (plik nie znaleziony), `memory.ts` (alternatywne repozytorium), i szczegóły `mcp/oauth.ts`.

2. **Co jest już jasne:**
   - Pełna architektura: Hono API → chat routes → chat service → runner → providers/tools/MCP → repositories
   - Maszyna stanów agenta i cykl życia
   - Hierarchia agentów (parent → child delegation)
   - System szablonów z Markdown
   - Multi-provider support (OpenAI, Gemini, OpenRouter)
   - System eventów i integracja Langfuse
   - Pruning + sumaryzacja kontekstu
   - OAuth flow dla MCP serwerów HTTP

3. **Co wymaga jeszcze doprecyzowania:**
   - Implementacja rate limitera
   - Implementacja in-memory repository i kiedy jest używane
   - Czy `.env.example` istnieje
   - Szczegóły `mcp/oauth.ts` (plik-backed token storage)
   - Czy `gpt-5.4` to celowy domyślny model czy placeholder
   - Dokładna implementacja `src/utils/tokens.ts` (estymacja tokenów dla pruningu)

---

**User**

W finalnym dokumencie skup się bardziej na realnym działaniu aplikacji niż na opisie każdego folderu osobno.
Najważniejsze jest:
- jak to działa,
- jak tego używać,
- gdzie jest najważniejsza logika,
- jak szybko wejść w projekt jako developer.

Na podstawie poprzedniej analizy stwórz pełny dokument techniczny wyjaśniający architekturę projektu.

Zapisz go jako plik:
ARCHITECTURE_EXPLAINED_Claude_Opus4_6.md

Dokument ma być napisany po polsku.

Cel dokumentu:
Ma pomóc osobie technicznej zrozumieć:
- co robi aplikacja,
- jak działa architektura,
- jak przepływają dane,
- jak uruchomić projekt,
- jak używać rozwiązania,
- gdzie szukać najważniejszej logiki w kodzie.

Zasady:
- bazuj wyłącznie na realnym kodzie i strukturze repozytorium,
- nie pisz ogólników,
- nie twórz teorii oderwanej od repo,
- jeśli czegoś nie da się potwierdzić, oznacz to jako „Założenie”,
- pisz jasno, technicznie i konkretnie.

Dokument ma zawierać następujące sekcje:

# 1. Podsumowanie projektu
- co robi aplikacja,
- jaki problem rozwiązuje,
- jaki jest główny scenariusz użycia,
- jakie są najważniejsze elementy techniczne.

# 2. Architektura wysokopoziomowa
- opisz główne części systemu,
- pokaż jakie są warstwy i moduły,
- opisz odpowiedzialności najważniejszych elementów.

Dodaj diagram Mermaid pokazujący architekturę wysokopoziomową.

# 3. Struktura repozytorium
- opisz najważniejsze foldery i pliki,
- wskaż gdzie jest:
  - główna logika,
  - konfiguracja,
  - typy,
  - komponenty,
  - serwisy,
  - utility,
  - integracje,
  - entry pointy.

# 4. Główny przepływ działania aplikacji
Opisz krok po kroku:
- co dzieje się od uruchomienia,
- jak działa główny flow,
- jak system przechodzi od inputu do outputu.

Dodaj diagram Mermaid typu sequence diagram.

# 5. Przepływ danych
- jakie dane wchodzą do systemu,
- jak są przetwarzane,
- między jakimi modułami przepływają,
- jakie dane wychodzą z systemu.

Dodaj diagram Mermaid pokazujący data flow.

# 6. Kluczowe moduły i komponenty
Dla każdego ważnego modułu opisz:
- rolę,
- wejście,
- wyjście,
- odpowiedzialność,
- zależności,
- ważne pliki i funkcje.

# 7. Runtime i sposób uruchamiania
- jak startuje aplikacja,
- jaka jest kolejność inicjalizacji,
- jak działa lifecycle,
- czy są procesy asynchroniczne,
- czy są eventy, joby albo specjalne mechanizmy wykonania.

# 8. Konfiguracja i środowisko
- opisz configi,
- env variables,
- ważne ustawienia,
- zależności środowiskowe.

# 9. Jak uruchomić projekt
Przygotuj praktyczną instrukcję:
- wymagania,
- instalacja,
- konfiguracja,
- komendy uruchomieniowe,
- build,
- testy,
- jak sprawdzić, że działa poprawnie.

# 10. Jak używać rozwiązania
- jak uruchomić główny scenariusz,
- jakie są inputy,
- jakie są outputy,
- jak praktycznie korzystać z aplikacji.

# 11. Ważne decyzje architektoniczne
- jak podzielono odpowiedzialności,
- jakie wzorce są widoczne,
- jakie są mocne strony tej architektury,
- jakie są kompromisy.

# 12. Ryzyka, luki i trudniejsze miejsca
- co może być problematyczne,
- co jest niejasne,
- co może utrudniać rozwój lub debugowanie.

# 13. Szybki przewodnik po kodzie
Przygotuj sekcję typu:
- jeśli chcesz zrozumieć start aplikacji → zajrzyj tutaj,
- jeśli chcesz zmienić logikę główną → zajrzyj tutaj,
- jeśli chcesz debugować problem → zajrzyj tutaj,
- jeśli chcesz zrozumieć konfigurację → zajrzyj tutaj.

# 14. Najważniejsze pliki do przeczytania
Podaj top 10 najważniejszych plików lub modułów z krótkim opisem, po co je czytać.

Wymagania dodatkowe:
- użyj poprawnego Markdown,
- użyj diagramów Mermaid bez przesady, ale sensownie,
- dokument ma być konkretny i repozytorium-specyficzny,
- nie może być zbyt ogólny,
- ma nadawać się jako materiał onboardingowy dla osoby technicznej.

---

**Cursor**

Mam już wszystkie brakujące szczegóły. Tworzę dokument.

Dokument został zapisany jako `ARCHITECTURE_EXPLAINED_Claude_Opus4_6.md`.

Skupiłem się na tym, co najważniejsze dla developera wchodzącego w projekt:

- **Jak to działa** — pełny flow od requestu HTTP przez pętlę agentową do odpowiedzi, z sequence diagramem Mermaid
- **Jak tego używać** — konkretne przykłady curl dla każdego scenariusza (single-turn, multi-turn, streaming, deliver, tworzenie własnego agenta)
- **Gdzie jest logika** — zamiast opisywać każdy folder, pogrupowałem pliki według pytań developera ("chcę zmienić główną logikę → tutaj", "chcę dodać narzędzie → tutaj")
- **Szybki przewodnik** — sekcja 13 to praktyczny routing "co chcesz zrobić → który plik otworzyć"
- **Top 10 plików** — z uzasadnieniem, dlaczego akurat te i co z nich wynika

Dokument zawiera 3 diagramy Mermaid (architektura wysokopoziomowa, sequence diagram flow, data flow) i jest w pełni oparty na realnym kodzie — żadnych ogólników.


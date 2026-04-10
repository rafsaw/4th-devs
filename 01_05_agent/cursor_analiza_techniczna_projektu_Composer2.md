# Analiza techniczna projektu TypeScript
_Exported on 4/7/2026 at 16:28:19 CDT from Cursor (3.0.12)_

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


Przeglądając repozytorium: struktura, `package.json`, punkty wejścia i kluczowe moduły.




Poniżej analiza oparta na faktycznym kodzie w `01_05_agent` (bez tworzenia osobnego dokumentu Markdown ani diagramów).

---

## 1. Cel projektu

**Co robi aplikacja:** Serwer HTTP (REST + SSE) udostępniający **API „agentowego” czatu** — wieloturowa pętla z modelem LLM, narzędziami wbudowanymi, delegowaniem do pod-agentów oraz narzędziami z serwerów **MCP**. Stan rozmów, użytkowników i agentów jest trzymany w **SQLite** (LibSQL). Szablony agentów to pliki **Markdown z front matter** w katalogu workspace.

**Problem:** scentralizowane uruchamianie agentów z wieloma dostawcami AI, persystencją, narzędziami, MCP i obserwowalnością (Langfuse/OpenTelemetry), zamiast jednorazowych skryptów.

**Główny scenariusz:** klient (np. `curl`) wywołuje `POST /api/chat/completions` z nagłówkiem `Authorization: Bearer <klucz API użytkownika>`, opcjonalnie wskazuje agenta (`agent: "alice"`), treść `input` i ewentualnie `sessionId` dla wielu tur; serwer zapisuje wiadomości, odpala runner agenta i zwraca tekst / wywołania narzędzi / stan `waiting` z możliwością wznowienia przez `deliver`.

---

## 2. Punkty wejścia

- **Proces Node:** `src/index.ts` — jedyny wyraźny bootstrap serwera.
- **Sekwencja:** `initRuntime()` → `serve({ fetch: app.fetch, ... })` z `@hono/node-server` → obsługa `SIGINT`/`SIGTERM` z `shutdownRuntime()`.
- **Aplikacja HTTP:** instancja Hono w `src/lib/app.ts` eksportowana jako `app`.

---

## 3. Struktura repozytorium

| Obszar | Ścieżki | Rola |
|--------|---------|------|
| Bootstrap / serwer | `src/index.ts`, `src/lib/app.ts`, `src/lib/runtime.ts`, `src/lib/config.ts`, `src/lib/logger.ts`, `src/lib/tracing.ts` | start, konfiguracja, inicjalizacja „runtime”, logi, tracing |
| API | `src/routes/` (`chat.ts`, `chat.service.ts`, `chat.turn.ts`, `chat.schema.ts`, `chat.response.ts`, `mcp.ts`, `index.ts`) | endpointy pod `/api` (+ osobne mountowanie MCP pod `/m`) |
| Logika agenta | `src/runtime/runner.ts`, `src/runtime/context.ts` | pętla tur, streaming, narzędzia, delegacja, `deliverResult` |
| Domena (stan czysty) | `src/domain/` | typy i przejścia stanów agenta, sesji, itemów |
| Persystencja | `src/repositories/` (głównie `sqlite/`, `schema.ts`) + `src/db/setup.ts`, `seed.ts` | repozytoria; migracje Drizzle w `drizzle/` |
| LLM | `src/providers/` (OpenAI/OpenRouter jako jeden adapter, Gemini osobno) | `generate` / `stream`, rejestr providerów |
| Narzędzia | `src/tools/` | rejestr, `calculator`, `delegate` |
| MCP | `src/mcp/` | klient SDK, `.mcp.json`, OAuth dla HTTP |
| Workspace | `src/workspace/`, katalog `workspace/agents/*.agent.md` | ładowanie szablonów agentów |
| Utils | `src/utils/` (pruning, summarization, tokens) | kontekst / skracanie rozmowy |
| Middleware | `src/middleware/` | Bearer + rate limit |
| Zdarzenia | `src/events/` | emitter + subskrybenci (log, Langfuse) |
| Konfiguracja modeli | `src/config/models.ts` | okna kontekstu, progi pruning |
| Demo | `src/examples.ts` | `printExamples` po starcie |
| Spec / docs | `spec/`, `README.md` | dokumentacja zewnętrzna (nie zawsze zsynchronizowana z kodem) |

**Główna logika biznesowa:** `runtime/runner.ts` + `routes/chat.*` + `domain/*` + repozytoria.

**Założenie:** w `package.json` jest też `createMemoryRepositories` w repozytoriach — w runtime używane jest wyłącznie `createSQLiteRepositories` (w kodzie `lib/runtime.ts`); pamięć wygląda na alternatywę/testową, nie na domyślną ścieżkę produkcyjną tej aplikacji.

---

## 4. Stack technologiczny

- **Runtime:** Node, **TypeScript** (ESM, `NodeNext`), uruchamianie przez **tsx**.
- **HTTP:** **Hono** + `@hono/node-server`, walidacja **Zod** (`@hono/zod-validator`).
- **Baza:** **Drizzle ORM** + **@libsql/client** (SQLite plik lub Turso).
- **AI:** **openai**, **@google/genai**, rejestr własny; OpenRouter jako drugi „provider” na tym samym adapterze co OpenAI.
- **MCP:** `@modelcontextprotocol/sdk`.
- **Observability:** **OpenTelemetry** + **Langfuse** (`@langfuse/tracing`, `@langfuse/otel`).
- **Inne:** **pino**, **gray-matter** (front matter agentów).

**Typ aplikacji:** **backend API** (bez aplikacji frontendowej w tym repo — `jsx` w `tsconfig` pod Hono JSX, ale w `src` nie ma plików `.tsx`).

---

## 5. Główny przepływ działania

1. Start: `initRuntime()` rejestruje providerów (klucze z env), otwiera SQLite, tworzy registry narzędzi (calculator, delegate), startuje **McpManager** z `.mcp.json`, ładuje listę agentów z workspace, tworzy **EventEmitter** z subskrypcjami.
2. Żądanie `POST /api/chat/completions`: middleware — `injectRuntime`, **bearerAuth** (hash SHA-256 klucza → użytkownik w DB), rate limit.
3. `setupChatTurn`: rozwiązanie konfiguracji agenta (szablon z dysku vs pola z JSON), merge narzędzi z rejestru, sesja (nowa lub `sessionId`), **jeden root agent na sesję** (aktualizacja konfiguracji / ponowne użycie), dopisanie wiadomości użytkownika jako `items`.
4. `runAgent` / `runAgentStream`: dla każdej tury — załadowanie itemów, ewentualny **pruning** + **summarization**, wywołanie `provider.generate` lub `stream`, zapis odpowiedzi (wiadomości asystenta, `function_call`, `reasoning`).
5. Przy wywołaniu narzędzia: sync z registry → wykonanie; nazwa `server__tool` → **MCP**; typ `agent` (delegate) → tworzenie child agenta i rekurencyjny `runAgent`; nierozpoznane → stan **waiting** + później `POST .../deliver`.
6. Odpowiedź HTTP: mapowanie do `ChatResponse` (tekst, `function_call`, `waitingFor`), kody 200 vs 202 dla `waiting`; SSE przy `stream: true`.

---

## 6. Moduły i odpowiedzialności

- **`lib/app.ts`:** składanie Hono, CORS, limity, routing `/health`, `/api/*`, publiczne `/mcp/*` (callback OAuth).
- **`lib/runtime.ts`:** fabryka zależności; `getAgent()` — odświeżany szablon z dysku.
- **`routes/chat*`**:** warstwa HTTP + orchestracja `prepareChat` / `runAgent` / `deliver`.
- **`runtime/runner.ts`:** rdzeń agentowy (tury, narzędzia, MCP, delegacja, auto-propagation wyniku child → parent w `deliverResult`).
- **`domain/*`:** reguły stanów (pending/running/waiting/completed/failed).
- **`repositories/*`:** CRUD users, sessions, agents, items.
- **`providers/*`:** abstrakcja wywołań modelu.
- **`mcp/*`:** połączenia stdio/HTTP, lista i wywołanie narzędzi z prefiksami.
- **`workspace/loader.ts`:** Markdown → template; mapowanie nazw narzędzi na definicje (wbudowane / `web_search` / MCP).

Komunikacja: głównie **wywołania synchroniczne** i **RuntimeContext** przekazywany przez kontekst Hono; zdarzenia przez **`events`** dla logów i Langfuse.

---

## 7. Konfiguracja projektu

- **`src/lib/config.ts`:** wczytuje `.env` z **najpierw** `../../.env` (katalog projektu), potem `../../../.env` (root monorepo) — pierwsze nie nadpisuje już ustawionych zmiennych.
- **Ważne zmienne:** `PORT`, `HOST`, `DATABASE_URL`, klucze `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY`, `DEFAULT_MODEL`, `WORKSPACE_PATH`, limity CORS/body/timeout, `RATE_LIMIT_RPM`, Langfuse, `AGENT_MAX_TURNS` (patrz niżej — w kodzie runnera nieużywane).
- **MCP:** `.mcp.json` w katalogu roboczym (przykład: `.mcp.example.json`).
- **Drizzle:** `drizzle.config.ts` ładuje `.env` z katalogu projektu i wskazuje `schema.ts`.

**Niespójność (fakt z porównania README vs kod):** README w tabeli env podaje `AUTH_TOKEN` jako wymagane; w `config.ts` nie ma `AUTH_TOKEN` — autoryzacja opiera się o **Bearer + tabela users** (seed).

---

## 8. Jak uruchamiany jest projekt

Skrypty z `package.json`:

- `npm run dev` — `tsx watch src/index.ts`
- `npm run start` — `tsx src/index.ts`
- `npm run build` — `tsc` (output `dist/`)
- `db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle Kit
- `db:seed` — `tsx src/db/seed.ts`

**Brak** skryptu `test` w `package.json`.

---

## 9. Jak używać rozwiązania (developer / użytkownik API)

1. `npm install`, skopiować `.env` (wg README `.env.example`), `npm run db:push`, `npm run db:seed`, `npm run dev`.
2. Klucz z seeda: domyślnie ten sam co w `examples.ts` / README (nadpisywalny `SEED_API_KEY`).
3. **Wejście:** JSON na `/api/chat/completions` (`agent`, `input`, opcjonalnie `sessionId`, `model`, `stream`, …).
4. **Wyjście:** JSON `{ data: ChatResponse, error }` lub SSE; nagłówki `X-Session-Id`, `X-Agent-Id`; przy `waiting` — `202` i `waitingFor`, potem `POST /api/chat/agents/:agentId/deliver` z `callId` i `output`.
5. MCP OAuth: publiczne ścieżki `/mcp/...` dla callbacku; lista serwerów z API pod `/api/mcp/servers` (z Bearer).

---

## 10. Najważniejsze miejsca do zrozumienia (5–10)

1. **`src/index.ts`** — punkt startu i shutdown.
2. **`src/lib/runtime.ts`** — co dokładnie składa się w „runtime” przy starcie.
3. **`src/lib/app.ts`** — routing, middleware, podwójne mountowanie MCP (`/api/mcp` vs `/mcp`).
4. **`src/runtime/runner.ts`** — cała semantyka agenta (największy plik, serce systemu).
5. **`src/routes/chat.turn.ts`** — jak sesja i root agent są wiązane z żądaniem.
6. **`src/routes/chat.service.ts`** — jak HTTP mapuje się na `runAgent` / `deliver`.
7. **`src/workspace/loader.ts`** — jak `.agent.md` staje się modelem + narzędziami.
8. **`src/mcp/client.ts`** — konfiguracja serwerów i prefiksy narzędzi.
9. **`src/lib/config.ts`** — prawda o env i regułach (np. production CORS).
10. **`src/repositories/sqlite/schema.ts`** — model danych (users, sessions, agents, items).

---

## 11. Ryzyka, niejasności, trudne miejsca

- **`runner.ts`** jest duży i łączy: LLM, DB, MCP, delegację, pruning, Langfuse — **wysoka złożoność poznawcza** i trudniejszy debug.
- **Dwa mounty tego samego routera MCP** (`/mcp` publicznie, `/api/mcp` z auth) — łatwo pomylić URL w dokumentacji vs rzeczywiste potrzeby (callback musi być publiczny).
- **`AGENT_MAX_TURNS` w config** jest eksportowany, ale **`runAgent` używa stałej `maxTurns: 10`** w `chat.service.ts` / delegacji — **rozjazd dokumentacja–konfiguracja–kod**.
- **README vs kod:** `AUTH_TOKEN`, domyślny model w README (`gpt-4.1`) vs `config.defaultModel` (`${defaultProvider}:gpt-5.4` gdy brak `DEFAULT_MODEL`).
- **Brak testów automatycznych** w skryptach — regresje trudniej wyłapać.
- **Delegacja:** głębokość ograniczona (`MAX_AGENT_DEPTH = 5`), child ma **hardcoded `maxTurns: 10`** w delegacji — może być mylące względem głównego agenta.
- **Założenie:** zachowanie przy braku kluczy AI (ostrzeżenie w logu, ale endpointy mogą failować dopiero przy generacji) — nie czytałem każdej ścieżki błędu w providerach.

---

## Podsumowanie

1. **Jak dobrze rozumiem ten projekt w skali 1–10:** **8** — główny flow, warstwy i pliki kluczowe są jasne; drobne rozjazdy docs/config wymagają weryfikacji przy zmianach.
2. **Co jest już jasne:** architektura backendu, bootstrap, API chat + deliver, rola MCP i workspace, SQLite/Drizzle, auth przez Bearer + hash, struktura `runner` i zdarzeń.
3. **Co warto jeszcze doprecyzować w kodzie (jeśli będzie potrzeba):** pełne ścieżki błędów w adapterach OpenAI/Gemini, dokładne zachowanie streamingu SSE przy `waiting`, ewentualne użycie `createMemoryRepositories`, oraz dopięcie `AGENT_MAX_TURNS` do faktycznych limitów w `runAgent` albo usunięcie z config jako mylące.

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
ARCHITECTURE_EXPLAINED_composer2.md

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


Tworząc dokument, weryfikuję kilka szczegółów w kodzie (skrypty, ścieżki API), aby treść była zgodna z repozytorium.




Tworzę pełny dokument `ARCHITECTURE_EXPLAINED_composer2.md`.




Plik **`ARCHITECTURE_EXPLAINED_composer2.md`** jest zapisany w katalogu projektu `01_05_agent`.

Zawiera wszystkie wymagane sekcje (1–14), trzy diagramy Mermaid (flowchart architektury, sequence dla chatu, data flow), konkretne odniesienia do ścieżek i funkcji z kodu oraz praktyczne kroki uruchomienia i użycia API. Ująłem też ustalone rozjazdy (np. `AGENT_MAX_TURNS` vs sztywne `maxTurns: 10`, brak skryptu `test`, różnica README vs Bearer/users zamiast `AUTH_TOKEN`).

Jeśli chcesz, mogę dopasować ton (krócej/dłużej) albo dodać jeden diagram (np. stan agenta) — napisz tylko preferencję.


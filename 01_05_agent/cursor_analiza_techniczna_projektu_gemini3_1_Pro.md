# Analiza techniczna projektu repozytorium
_Exported on 4/7/2026 at 16:27:28 CDT from Cursor (3.0.12)_

---

**User**

Twoim zadaniem jest NAJPIERW przeanalizować to repozytorium i przygotować techniczną analizę projektu.

Nie twórz jeszcze finalnego dokumentu.
Chcę tylko analizę i zrozumienie projektu.

Skup się na konkretnym kodzie — nie zgaduj, tylko wnioskuj na podstawie repo.

Odpowiedz w języku polskim.

Przeanalizuj repo i opisz:

# 1. Punkty wejścia (entry points)
- gdzie startuje aplikacja (np. main.py, app.ts, Program.cs, itp.)
- co uruchamia system
- jak wygląda bootstrap aplikacji

# 2. Struktura projektu (high-level)
- najważniejsze foldery i ich rola
- gdzie jest logika biznesowa
- gdzie jest warstwa API / UI / backend
- gdzie są integracje

# 3. Technologie i stack
- frameworki
- biblioteki
- zależności (z package.json / requirements.txt / csproj itd.)

# 4. Przepływ requestu / danych (na poziomie ogólnym)
- co się dzieje od wejścia do wyjścia
- jakie komponenty są po drodze

# 5. Konfiguracja
- gdzie są pliki konfiguracyjne (.env, settings, config)
- jak aplikacja zarządza środowiskiem

# 6. Integracje zewnętrzne
- API
- bazy danych
- Azure / OpenAI / Search / inne serwisy

# 7. AI / LLM (jeśli istnieje)
- gdzie są prompty
- gdzie jest logika AI
- czy jest RAG / embeddings / tools / agenci
- jak wygląda pipeline AI

# 8. Miejsca kluczowe do zrozumienia projektu
- top 5–10 plików, które warto przeczytać
- dlaczego są ważne

# 9. Niejasności / ryzyka
- rzeczy które są nieoczywiste
- miejsca które mogą być kruche
- rzeczy których nie da się jednoznacznie wywnioskować

Ważne:
- nie twórz jeszcze dokumentu Markdown
- nie używaj Mermaid
- skup się na analizie i zrozumieniu
- jeśli czegoś nie jesteś pewien → oznacz jako "Założenie"

Na końcu daj krótkie podsumowanie:
"Jak dobrze rozumiem ten projekt (1–10) + dlaczego"

---

**Cursor**

Na podstawie analizy kodu z repozytorium, przygotowałem dla Ciebie techniczną analizę projektu. Analiza opiera się w 100% na rzeczywistym kodzie, bez zgadywania.

# 1. Punkty wejścia (entry points)
- Głównym punktem startowym aplikacji jest plik `src/index.ts`. Zgodnie z deklaracjami w `package.json`, aplikacja uruchamiana jest przez komendy `tsx watch src/index.ts` (w trybie deweloperskim) lub `tsx src/index.ts`.
- **Bootstrap aplikacji**: 
  - W pliku `src/index.ts` wywoływana jest asynchroniczna funkcja `main()`.
  - Najpierw uruchamiane jest `initRuntime()` z `src/lib/runtime.ts` — to serce aplikacji. Podnosi on połączenie z bazą danych (SQLite), rejestruje dostępców AI (OpenAI, Gemini), narzędzia (tools), ładuje definicje agentów z dysku (z folderu workspace) oraz podpina serwery MCP.
  - Następnie startuje serwer HTTP `Hono` dla node.js (`serve`).
  - Zaprogramowane jest eleganckie ubijanie procesu (`shutdownRuntime`), które reaguje na `SIGINT` / `SIGTERM` i zamyka w pierwszej kolejności połączenia do serwerów MCP.

# 2. Struktura projektu (high-level)
Najważniejsze foldery w projekcie to:
- `src/lib/` – rdzeń i konfiguracja aplikacji (routing Hono, konfiguracja `.env`, integracja loggera Pino i tracingu).
- `src/routes/` – warstwa API. Główny ruch wchodzi przez endpointy zdefiniowane w `chat.ts` i obsługiwany jest przez `chat.service.ts`. 
- `src/runtime/` – tutaj znajduje się **cała logika biznesowa systemu agentowego**. W pliku `runner.ts` zaimplementowana jest pętla stanowa agentów (turn loop), która komunikuje się z LLM.
- `src/repositories/` – warstwa dostępu do danych (Data Access Layer). Używany jest wzorzec repozytorium nałożony na Drizzle ORM (z plikiem schematu `schema.ts`).
- `src/workspace/` i główny folder `workspace/` – w kodzie widoczny jest `loader.ts`, który z folderu `workspace/agents/` ładuje systemowe prompty i definicje narzędzi z plików Markdown z frontmatterem (np. `alice.agent.md`).
- `src/mcp/` – integracja z Model Context Protocol, pozwalająca podpinać zewnętrzne narzędzia.

# 3. Technologie i stack
- **Język i środowisko**: TypeScript odpalany na Node.js przez `tsx`.
- **Framework webowy**: `hono` (wraz z wtyczkami m.in. `@hono/node-server`, `@hono/zod-validator`).
- **Baza Danych**: `libsql/client` (SQLite) z ORMem `drizzle-orm` (oraz `drizzle-kit` do migracji).
- **Walidacja i schematy**: `zod`.
- **Integracje AI**: oficjalne biblioteki `@google/genai` (Gemini) oraz `openai` (obsługuje również OpenRouter).
- **Parsowanie definicji Agentów**: `gray-matter` do czytania frontmattera z plików Markdown.
- **Obserwowalność (Tracing/Logging)**: `pino` do logowania i `@langfuse/tracing` (wraz z opentelemetry) do śledzenia wywołań AI.
- **Zależności zewnętrzne**: `@modelcontextprotocol/sdk` do integracji z serwerami MCP.

# 4. Przepływ requestu / danych (na poziomie ogólnym)
1. Request od klienta uderza np. na `/api/chat/completions` (w `src/routes/chat.ts`).
2. Żądanie zostaje zwalidowane (przez Zod) i wstrzykiwany jest do niego kontekst `runtime`.
3. Wywoływane jest `prepareChat` i `executePreparedChat` (w `chat.service.ts`).
4. Ruch przekazywany jest do serca agenta, czyli funkcji `runAgent` w `src/runtime/runner.ts`. Tam aplikacja ładuje historię z bazy danych (wraz z tzw. pruningiem, czyli ewentualnym kompresowaniem/skracaniem długich historii konwersacji).
5. Zapytanie jest wysyłane do providera AI.
6. Aplikacja czeka na odpowiedź. Jeśli odpowiedź to zwykły tekst, czat jest kończony i zwracany do usera (jako standardowy JSON lub przez Streaming SSE).
7. Jeśli LLM zwróci prośbę o użycie narzędzia (Function Call), system odpala narzędzie (np. natywne lub to z MCP), zapisuje wynik do bazy i pętla w `runner.ts` wraca z powrotem do LLM z wynikiem narzędzia.
8. [Założenie/Wynika z kodu]: Jeśli narzędzie jest "zewnętrzne/asynchroniczne" (brak handlera w registry), Agent otrzymuje w bazie status `waiting` (zawieszony), wysyła do klienta kod 202, by ten na niego później "odpowiedział" asynchronicznie przez endpoint `/agents/:agentId/deliver`.

# 5. Konfiguracja
- Główny punkt zarządzania środowiskiem to plik `src/lib/config.ts`.
- Skrypt sam radzi sobie z wczytaniem pliku `.env` poprzez natywną funkcję `process.loadEnvFile` wprowadzając priorytety (najpierw szuka w `.env` w folderze domowym, a ewentualne braki łata z domyślnego pliku w root). 
- Cała zmienna globalna `config` jest walidowana przez schematy `Zod`, narzucając na start sprawdzenie kluczy, np. `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, portów, ścieżki do bazy danych.

# 6. Integracje zewnętrzne
- **API AI**: OpenAI, Gemini, OpenRouter.
- **Baza danych**: Lokalny plik SQLite skonfigurowany pod `DATABASE_URL` (domyślnie w `.data/agent.db`).
- **Narzędzia dynamiczne (MCP)**: Konfiguracja zakłada obecność serwerów MCP. Zewnętrzne serwisy i integracje mogą być podłączone dynamicznie przez dodanie serwerów MCP, które system zmapuje i zgłosi do LLM jako funkcje narzędziowe (Tools).
- **Logowanie/Metryki**: Langfuse (w oparciu o OpenTelemetry).

# 7. AI / LLM (jeśli istnieje)
- **Prompty**: Aplikacja nie trzyma systemowych promptów w kodzie `.ts`. Zamiast tego są one utrzymywane w dedykowanym folderze na dysku `workspace/agents/`, skąd są dynamicznie wczytywane podczas runtime'u za pomocą parsera Markdown (`gray-matter`).
- **Zarządzanie kontekstem (RAG/Pamięć)**: Nie widać klasycznej bazy wektorowej (embeddings). Zamiast tego zaimplementowany jest moduł Pruningu (`src/utils/pruning.ts` i `summarization.ts`). Jeśli agent wygeneruje za dużo turnów konwersacji, w locie uruchamiany jest mechanizm, który ucina starą część rozmowy i prosi model AI o jej "streszczenie", aktualizując tym samym skrócone "summary" w tabeli sesji.
- **Orkiestracja i agenci (Delegacja)**: Zaimplementowany jest bardzo solidny system hierarchii agentów. Istnieje natywne narzędzie `delegate` (w `src/tools/definitions/delegate.ts`), dzięki któremu agent LLM może "urodzić" i wywołać pod-agenta (child agent), aby zlecić mu część pracy. Rodzic zostaje zawieszony do momentu zakończenia pracy przez sub-agenta (limit zagnieżdżeń: głębokość 5). 

# 8. Miejsca kluczowe do zrozumienia projektu
1. **`src/runtime/runner.ts`** – Serce całego projektu. Skomplikowana pętla `executeTurn`, obsługa delegacji sub-agentów (`handleDelegation`), zawieszanie i wznawianie procesu (`waitingFor`), zapis do polimorficznej tabeli `items`.
2. **`src/repositories/sqlite/schema.ts`** – Definicja bazy danych w Drizzle ORM. Pozwala natychmiast zrozumieć strukturę aplikacji: drzewiasta struktura Agentów (`rootAgentId`, `parentId`), Sesje, encje typu User i polimorficzne wiaderko na wiadomości (`Items`).
3. **`src/routes/chat.service.ts`** – Pokazuje jak odpytywanie po REST API HTTP wiąże się ze skomplikowaną logiką engine'u runtime'owego LLM. Znajdują się tam transformacje z wewnętrznego stanu na obiekty do zwrócenia na frontend.
4. **`src/workspace/loader.ts`** – Wyjaśnia zjawisko braku promptów w repo. Odsłania modułowy charakter systemu, który odczytuje swoje umiejętności (i konfiguracje konkretnego agenta/modelu LLM) z plików Markdown użytkownika.
5. **`src/lib/runtime.ts`** – Bootstrap i powiązanie providerów (OpenAI, Gemini), narzedzi, bazy danych, menedżera MCP oraz telemetrii Langfuse w jeden główny obiekt `RuntimeContext`.

# 9. Niejasności / ryzyka
- **Zawieszenie Agentów (Waiting)**: Koncepcja wstrzymywania procesu i zapisu ze statusem `waiting` w bazie, gdy odpalane jest asynchroniczne narzędzie (bądź inny proces klienta), wymaga aby konsument (frontend/inny serwis API) miał odpowiednio oprogramowany polling po GET `/agents/:agentId` i uderzał na punkt dostarczenia wyniku POST `/agents/:agentId/deliver`. To może być trudne w obsłudze przy usterkach w sieci.
- **SQLite locks**: Użycie lokalnej bazy SQLite i synchroniczne blokady zapisu przy wielowątkowym/wielokonwersacyjnym dostępie do agenta (chociaż dla modelu opartego o jedno środowisko wykonawcze to raczej marginalne ryzyko).
- **Pruning**: Model LLM podczas kompresji starych wiadomości generuje ich streszczenie (summarization). Przy bardzo długich konwersacjach może to oznaczać stałą utratę detali (hallucination drift) – model nie będzie już miał dostępu do konkretnych starych danych, lecz do ich streszczenia.
- **Zagnieżdżenia agentów**: Zjawisko delegacji do subagentów (`delegateTool`) może być narażone na ogromne koszty użycia API (Token Usage). Niektóre modele mogą zaciąć się w "pętli" bezowocnego wywoływania sub-agentów.

---

**Jak dobrze rozumiem ten projekt (1–10): 9/10**
Dlaczego: Architektura jest wyjątkowo elegancka, modularna i korzysta z nowoczesnych, "czystych" wzorców na styku TypeScriptu i LLM. Przebieg życia żądania, stan konwersacji (zapisywany w bazie SQLite podpiętej pod Drizzle) i hierarchiczna, rekurencyjna natura wywołań wewnątrz `runner.ts` są dla mnie jasne. Rozumiem też, skąd system pobiera swoją "wiedzę" (Model Context Protocol i loadery z plików .md). Jedyny element o wartości "1", który pozostawia margines, to mechanika tego, skąd fizycznie wstrzykiwane są definicje MCP w czasie uruchamiania (choć widać wzorzec ładowania pliku `.mcp.json` z plików ukrytych). Całość rysuje obraz dojrzałego, własnego "Agentic Framework" działającego w oparciu o asynchroniczne odpytywanie agentów.

---

**User**

W finalnym dokumencie skup się bardziej na realnym działaniu aplikacji niż na opisie każdego folderu osobno.
Najważniejsze jest:
- jak to działa,
- jak tego używać,
- gdzie jest najważniejsza logika,
- jak szybko wejść w projekt jako developer.

Na podstawie poprzedniej analizy stwórz pełny dokument techniczny wyjaśniający architekturę projektu.
W finalnym dokumencie skup się bardziej na realnym działaniu aplikacji niż na opisie każdego folderu osobno.
Najważniejsze jest:
- jak to działa,
- jak tego używać,
- gdzie jest najważniejsza logika,
- jak szybko wejść w projekt jako developer.


Zapisz go jako plik:
ARCHITECTURE_EXPLAINED_Gemini.md

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

Stworzyłem i zapisałem pełny dokument techniczny pod nazwą `ARCHITECTURE_EXPLAINED_Gemini.md` zgodnie z Twoimi wymaganiami. 

Skupiłem się na rzeczywistym działaniu aplikacji — opisałem odpalanie serwera (Hono/Node.js), pętlę decyzyjną (w `runner.ts`), przepływ danych do providerów AI, jak działają zewnętrzne narzędzia (MCP) oraz jak w locie czytane są definicje z plików Markdown (`loader.ts`). 

Dodałem również instrukcję "krok po kroku", z której nowy developer dowie się jak wgrać bazę SQLite, jak wystartować procesy, i jakich plików dotykać przy rozbudowie agentów. Dodałem też opisy trudniejszych miejsc (jak np. asynchroniczne zawieszanie stanu Agentów w statusie `waiting` i `pruning` kontekstu LLM).


---
name: Findhim workflow tools
overview: Zaplanowanie rozwiązania zadania findhim w architekturze workflow + tools, wzorowanej na 01_02_tools, z naciskiem na zrozumienie pętli agentowej i deterministycznej finalizacji verify.
todos:
  - id: cp1-skeleton
    content: Zbudować szkielet modułów i połączeń między nimi w 01_02_zadanie/src
    status: completed
  - id: cp2-tools-contract
    content: Zdefiniować narzędzia i ich schematy JSON + kontrakty wejścia/wyjścia
    status: completed
  - id: cp3-loop
    content: Dodać pętlę workflow z obsługą function calling i limitami kroków
    status: completed
  - id: cp4-domain-report
    content: Dodać logikę filtrowania, batch tagowania i budowę raport.json
    status: completed
  - id: cp5-verify
    content: Dodać deterministyczny verify, zapis wynik.md i test końcowy
    status: completed
isProject: false
---

# Plan implementacji findhim (workflow + tools)

## Założenia architektoniczne

- Bazujemy na wzorcu z `[01_02_tools/app.js](01_02_tools/app.js)` i `[01_02_tools/helper.js](01_02_tools/helper.js)`: model decyduje o tool callach, kod JS wykonuje narzędzia i odsyła wyniki do kontekstu.
- Rozdzielamy odpowiedzialności: `tools` (co model może wywołać), `handlers` (co naprawdę robi kod), `workflow loop` (sterowanie), `verify` (deterministyczny finał).
- Używamy taniego modelu jako default (zgodnie z Twoim wymaganiem), a Structured Output tylko tam, gdzie potrzebna klasyfikacja zawodów.

## Checkpointy

### Checkpoint 1 — Architektura i szkielet projektu

- Utworzenie czytelnej struktury plików w `[01_02_zadanie/src](01_02_zadanie/src)`:
  - `[01_02_zadanie/src/main.js](01_02_zadanie/src/main.js)`
  - `[01_02_zadanie/src/workflow.js](01_02_zadanie/src/workflow.js)`
  - `[01_02_zadanie/src/tools.js](01_02_zadanie/src/tools.js)`
  - `[01_02_zadanie/src/handlers.js](01_02_zadanie/src/handlers.js)`
  - `[01_02_zadanie/src/people.js](01_02_zadanie/src/people.js)`
  - `[01_02_zadanie/src/report.js](01_02_zadanie/src/report.js)`
  - `[01_02_zadanie/src/verify.js](01_02_zadanie/src/verify.js)`
- Dodanie minimalnych interfejsów funkcji (bez pełnej logiki), żeby było jasne jak dane płyną.

### Checkpoint 2 — Definicja tools i kontrakty danych

- Definicja narzędzi (JSON Schema) w `[01_02_zadanie/src/tools.js](01_02_zadanie/src/tools.js)`:
  - `load_people`
  - `filter_candidates`
  - `tag_jobs_batch`
  - `build_report`
- Zdefiniowanie formatu wejścia/wyjścia każdego narzędzia i mapy `toolName -> handler`.

### Checkpoint 3 — Pętla workflow + tool calls

- Implementacja pętli analogicznej do `chat()` z lekcji w `[01_02_zadanie/src/workflow.js](01_02_zadanie/src/workflow.js)`:
  - request do Responses API,
  - odczyt tool calls,
  - wykonanie handlerów,
  - dołączenie `function_call_output` do kontekstu,
  - limit kroków ochronny.
- Logging kroków (co model zlecił i co zwróciło narzędzie) dla nauki/debugowania.

### Checkpoint 4 — Logika danych i raport.json

- Implementacja logiki domenowej:
  - wczytanie danych,
  - filtr (M, Grudziądz, wiek 20–40),
  - batch tagging z Structured Output,
  - wybór tagu `transport`.
- Budowanie i zapis `[01_02_zadanie/raport.json](01_02_zadanie/raport.json)`.

### Checkpoint 5 — Deterministyczny finał verify + wynik.md

- Deterministyczny krok końcowy poza modelem:
  - walidacja końcowego payloadu,
  - POST na `/verify` z `task: "people"`,
  - zapis odpowiedzi i flagi do `[01_02_zadanie/wynik.md](01_02_zadanie/wynik.md)`.
- Krótki smoke test całego przepływu end-to-end.

## Przepływ architektoniczny

```mermaid
flowchart TD
  userPrompt[UserPrompt] --> workflowLoop[WorkflowLoop]
  workflowLoop --> responsesApi[ResponsesAPI_lowCostModel]
  responsesApi -->|tool_calls| toolExecutor[ToolExecutor]
  toolExecutor --> handlers[DomainHandlers]
  handlers --> toolOutputs[FunctionCallOutputs]
  toolOutputs --> workflowLoop
  workflowLoop -->|final_data| deterministicFinal[DeterministicFinalStep]
  deterministicFinal --> verifyApi[HubVerifyAPI]
  deterministicFinal --> reportJson[raport.json]
  deterministicFinal --> wynikMd[wynik.md]
```



## Co dokładnie realizujemy najpierw (start Checkpoint 1)

- Ustalenie granic modułów i odpowiedzialności plików.
- Przygotowanie szkieletu importów/eksportów, aby kolejne checkpointy były tylko „wypełnianiem” gotowych miejsc.
- Dodanie prostego punktu wejścia (`main.js`) wywołującego `runWorkflow()` i osobnego `runDeterministicFinalize()`.

Kluczowa idea edukacyjna: model nie „robi wszystkiego”, tylko orkiestruje wywołania narzędzi, a krytyczny krok `verify` pozostaje deterministyczny i kontrolowany przez kod.
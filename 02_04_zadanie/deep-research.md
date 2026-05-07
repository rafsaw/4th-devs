---
created: 2026-04-30
updated: 2026-04-30
last-confirmed: 2026-04-30
type: concept
confidence: medium
tags: [course/ai-dev4, topic/agents, topic/research, topic/planning]
sources:
  - "[[raw/AI-Devs-4_s02e03/AI-Devs-4_s02e03_06!Generowanie_dlugich_form_tekstowych,_wedlug_ustalonych_zasad]]"
---

# Deep Research / Deep Action

Wzorzec wieloiteracyjnej eksploracji i syntezy przez agenta, generujący obszerny dokument na podstawie wielu źródeł. Znany jako "Deep Research" w ChatGPT, Gemini, Firecrawl; w szerszym kontekście — **Deep Action**. Źródło: [[s02e03]] · rozdział _06.

**Zmiana nazwy oddaje skalę zastosowań:**
> "Deep Action" to Deep Research bez ograniczenia do "badań" — wzorzec dla każdego zadania wymagającego czasu, wielu iteracji i obszernego wyniku.

## Mechanika

```
zapytanie użytkownika
  → [opcjonalnie] pytania doprecyzowujące
  → [opcjonalnie] wstępne przeszukiwanie (zawężenie + wzbogacenie kontekstu)
  → sparafrazowane, rozszerzone zapytanie
  → agent loop (kilkanaście–kilkadziesiąt minut, w tle):
      dekompozycja zapytania
      → przeszukiwanie źródeł
      → analiza (w tym: uruchamianie kodu)
      → identyfikacja brakujących elementów
      → kolejna iteracja pogłębionego wyszukiwania
      → synteza i weryfikacja finalnego dokumentu
  → finalny raport
```

## Klucz: doprecyzowanie przed startem

Oryginalne zapytanie użytkownika jest zwykle za ogólne. Dobre Deep Research flow:
1. **Pytania pogłębiające** — model zadaje 2-5 pytań przed startem
2. **Wstępne przeszukiwanie** — szybki scan aby zawęzić kontekst zapytania
3. **Parafraza** — generowanie precyzyjnego, rozbudowanego zapytania startowego

> Techniki doprecyzowywania i parafrazy nie są ekskluzywne dla Deep Research — przydają się przy każdym zadaniu niewymagającym natychmiastowej reakcji.

## Dostępne API

| Provider | Link | Uwagi |
|----------|------|-------|
| OpenAI | [Deep Research API](https://developers.openai.com/api/docs/guides/deep-research) | o3/o4-mini z deep research |
| Gemini | [Deep Research API](https://ai.google.dev/gemini-api/docs/deep-research) | Gemini Pro z deep research |
| Firecrawl | [Deep Research](https://docs.firecrawl.dev/features/alpha/deep-research#completed) | Alpha, nastawione na web crawl |

Zastosowania rekomendowane przez dostawców: pogłębione wyjaśnienia tematów, analizy rynkowe, rozbudowane raporty.

## Deep Action — generalizacja wzorca

Ten sam schemat pasuje do zadań poza "badaniami":

| Zadanie | Deep Action wariant |
|---------|-------------------|
| Generowanie kodu dla złożonego systemu | Dekompozycja → implementacja komponentów → integracja → weryfikacja |
| Audyt bezpieczeństwa kodu | Skanowanie → identyfikacja wektorów → analiza → raport |
| Onboarding dokumentacji | Zbieranie → synteza → identyfikacja luk → uzupełnianie |
| Planowanie projektu | Research → dekompozycja na tasks → identyfikacja ryzyk → plan |

## Implementacja referencyjna — aidevs-deeper

Spersonalizowany agent deep research działający wyłącznie na własnych danych (AI Dev3):
- Repo: [aidevs-deeper](https://github.com/iceener/aidevs-deeper)
- Główna logika: [deep.service.ts](https://github.com/iceener/aidevs-deeper/blob/main/src/services/agent/deep.service.ts)
- Nie generuje kilkusetstronicowych raportów — prosta implementacja kluczowych mechanik

## 🏗️ Architecture Thinking

- **Rola w systemie:** orchestration — agent koordynuje wiele kroków wyszukiwania, analizy i syntezy
- **Core vs supporting:** supporting — wzorzec dla specyficznych zadań długotrwałych, nie codzienna logika agenta
- **Dependencies:** LLM (orchestrator + synthesis), narzędzie wyszukiwania (web lub local), opcjonalnie code execution
- **Trade-offy:**
  - Wysoka jakość wyniku → wysoki koszt tokenów i czas (minuty do godzin)
  - Brak natychmiastowej odpowiedzi → wymaga asynchronicznego interfejsu użytkownika
  - Lepsza jakość przez pogłębione iteracje → trudno przewidzieć czas zakończenia

## 🏢 Use Case Mapping (GENERIC)

**Typ problemu:** agent + research + generowanie długiej formy

**Gdzie pasuje:**
- Jednorazowe zadania wymagające dużej ilości informacji z wielu źródeł
- Wewnętrzne narzędzia do analiz, raportów, audytów
- Nie interaktywne chatboty — asynchroniczne zadania "w tle"

**Kiedy używać:**
- Zadanie niewymagające natychmiastowej odpowiedzi (>5 minut akceptowalne)
- Wynik to obszerny dokument, nie krótka odpowiedź
- Źródeł do przeszukania jest wiele i wymagają syntezy

**Kiedy NIE:**
- Użytkownik czeka na odpowiedź w czasie rzeczywistym → zbyt wolne
- Baza wiedzy jest ograniczona i znana z góry → wystarczy agentic RAG
- Prosta Q&A → przesadzony wzorzec

## ❌ Anti-patterns / risks

- **Brak doprecyzowania zapytania** — garbage in, garbage out; ogólne zapytanie generuje ogólny raport
- **Synchroniczne wywołanie** — blokowanie interfejsu przez kilkadziesiąt minut = zła UX
- **Brak weryfikacji końcowej** — agent może "dofantazjować" luki w znalezionych materiałach bez kroku weryfikacji
- **Brak budżetu kosztowego** — nieskończone iteracje = nieskończony koszt; zaimplementuj max_iterations lub token budget

## 🧪 Experiment / What to test

**Test: doprecyzowanie vs bez doprecyzowania**
- Setup: to samo zapytanie ("raport o trendach w AI"), raz z pytaniami doprecyzowującymi, raz bez
- Sprawdź: ocena "usefulness" wygenerowanych raportów (5-punktowa skala)
- Spodziewane: raport z doprecyzowaniem bardziej on-point

**Test: max_iterations a jakość**
- Setup: agent deep research, różne limity (3, 5, 10 iteracji)
- Mierz: długość raportu, liczba źródeł, subiektywna ocena głębokości
- Spodziewane: malejące zyski po ~5-7 iteracjach przy większości tematów

## Powiązane strony

- [[agentic-rag]] — podobna logika wieloetapowego wyszukiwania, ale dla Q&A
- [[knowledge-base-dla-agentow]] — Deep Research działający na własnych danych zamiast web
- [[workflow-i-agenci]] — orchestration i multi-agent coordination
- [[s02e03]] — pełna lekcja

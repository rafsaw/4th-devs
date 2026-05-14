---
created: 2026-05-13
updated: 2026-05-13
last-confirmed: 2026-05-13
type: concept
confidence: medium
tags: [course/ai-dev4, topic/agents, topic/performance, topic/architecture, topic/sandbox]
sources:
  - "[[raw/AI-Devs-4_s03e02/AI-Devs-4_s03e02_04!Zarzadzanie_niska_wydajnoscia_modeli_i_halucynacjami]]"
---

# Code Execution + Sandbox — agent generujący i uruchamiający kod

Wzorzec architektoniczny: zamiast ładować dane do kontekstu LLM, agent **generuje kod** który dane przetwarza, a następnie uruchamia go w **izolowanym sandboxie**. Eliminuje ograniczenie okna kontekstowego i zapewnia deterministyczne obliczenia.

## Problem który rozwiązuje

Standardowy agent przetwarza dane przez LLM:
- 240 plików z 150 000+ linii → nie mieści się w kontekście
- LLM "przeliczający w pamięci" → błędy numeryczne, halucynacje obliczeń
- Każda zmiana zakresu → nowe zapytanie z pełnym kontekstem → wysokie koszty

Code + Sandbox:
- LLM pisze skrypt → skrypt przetwarza dane deterministycznie → LLM interpretuje wynik
- Wolumen danych nieograniczony (dane są zmiennymi w kodzie, nie w prompcie)
- Obliczenia dokładne (kod, nie LLM, robi matematykę)

## 4-etapowy flow agenta

### 1. Eksploracja
Agent wczytuje strukturę katalogów (nie pliki). Orientuje się jakie dokumenty są dostępne, jaka jest hierarchia.

### 2. Nauka
Agent czyta **fragmenty** kilku plików — tyle żeby zrozumieć ich strukturę i format. Czyta też instrukcje (np. jak generować raporty finansowe, jak formatować PDF). Nie wczytuje całości.

### 3. Agregacja
Agent generuje skrypt zbierający dane ze wszystkich plików (korzystając ze zrozumianej struktury). Uruchamia go w sandboxie. Skrypt przetwarza pełny wolumen — agent dostaje zagregowany wynik.

### 4. Prezentacja
Agent generuje skrypt tworzący output (np. raport PDF, CSV, dashboard). Uruchamia go. Wynik: gotowy dokument.

## Architektura 3-procesowa

```
Proces Główny (Node.js / Python)
    ↕ STDIO
MCP Server
    ↕ API
Sandbox (Deno / Cloudflare / Daytona)
    ↕ system plików (read/write)
Dane źródłowe
```

- **Proces Główny** — agent + logika orchestracji
- **MCP (STDIO)** — bridge do sandboxa z kontrolą uprawnień
- **Sandbox** — izolowane środowisko wykonania kodu; może mieć sieciową izolację, limity CPU/RAM, własny filesystem

Sandbox Deno vs s02e05: Deno oferuje znacznie większe możliwości i lepszą kontrolę uprawnień niż sandbox z poprzedniej lekcji.

## 5 obszarów optymalizacji wydajności

Kontekst: zarządzanie szybkością agentów gdy natychmiastowa inferencja jest niedostępna:

| Obszar | Wpływ | Jak kontrolować |
|--------|-------|-----------------|
| **Tokeny wejściowe** | Czas reakcji | Skróć system prompt, definicje narzędzi, historię konwersacji |
| **Cache** | Koszt + czas reakcji | Prompt cache (tylko tokeny wejściowe); powtarzalne fragmenty promptu na początku |
| **Tokeny wyjściowe** | Czas generowania | Skróć odpowiedzi; ogranicz liczbę kroków agenta (mniej iteracji = mniej output tokenów łącznie) |
| **Liczba zapytań** | Czas całkowity | Równoleglenie zapytań; prompt cache; konsolidacja kroków |
| **Mniejsze modele** | Szybkość + koszt | Kosztem możliwości — dobór per typ zadania (Flash/mini do prostych, duże do złożonych) |

Code + sandbox adresuje jednocześnie kilka obszarów: agent robi mniej kroków (mniej zapytań), każdy krok ma krótszy input/output (mniej tokenów), a obliczenia realizuje kod (nie LLM).

## Sandbox w produkcji

Wyzwania skali:
- 3-procesowy system = wyższe koszty infrastruktury, złożoność deploymentu
- Tysiące równoczesnych użytkowników = tysiące procesów sandboxowych

Dostawcy sandboxów dla agentów:
- **Cloudflare Sandbox**: https://developers.cloudflare.com/sandbox/
- **Daytona**: https://www.daytona.io/

## 🏗️ Architecture Thinking

- **Rola w systemie:** processing — warstwa przetwarzania danych; agent jako orchestrator kodu
- **Core vs supporting:** generowanie kodu = core pattern; konkretny sandbox (Deno/Cloudflare) = supporting (wymienny)
- **Dependencies:** sandbox runtime (Deno, Node.js, Python), system plików, MCP lub własny bridge
- **Trade-offy:**
  - Deterministyczne obliczenia ↔ złożoność architektury: 3 procesy trudniejsze niż jeden agent
  - Nieograniczony wolumen danych ↔ czas generowania kodu: pierwsze uruchomienie wolniejsze (agent musi się nauczyć struktury)
  - Izolacja sieciowa ↔ dostęp do zewnętrznych API: sandbox bez sieci bezpieczniejszy, ale ograniczony

## 🏢 Use Case Mapping (GENERIC)

**Typ problemu:** extraction + processing (szczególnie dla dużych zbiorów)

**Gdzie pasuje:**
- processing layer — między surowymi danymi a prezentacją wyników
- Wszędzie gdzie dane > kilka MB lub > kilkaset plików

**Kiedy używać:**
- Dane przekraczają okno kontekstowe (lub zbliżają się do limitu)
- Obliczenia muszą być deterministyczne (finanse, statystyki, agregacje)
- Duży wolumen plików wymaga agregacji
- Masz dostęp do sandboxowego runtime

**Kiedy NIE:**
- Mały zbiór danych mieszczący się wygodnie w kontekście
- Dane mają nieustrukturyzowany format trudny do parsowania kodem
- Środowisko nie pozwala na uruchamianie zewnętrznych procesów
- Jednorazowy skrypt bez potrzeby weryfikacji

## ❌ Anti-patterns / risks

- **Ufanie że dane wczytały się poprawnie bez weryfikacji** — skrypt może wczytać błędnie sformatowane pliki; agent musi weryfikować wyniki agregacji
- **Sandbox bez izolacji sieciowej** — kod generowany przez agenta może wysłać dane na zewnątrz; sieć musi być zablokowana lub ścisle kontrolowana
- **Brak limitów uprawnień w sandboxie** — Deno i podobne dają granularną kontrolę (czytanie/pisanie konkretnych ścieżek, dostęp sieciowy); zawsze ograniczaj do minimum
- **Generowanie kodu do obliczeń krytycznych bez nadzoru** — przy ważnych dokumentach (finanse, raportowanie) agent+sandbox powinien pozostawać pod nadzorem człowieka

## 🧪 Experiment / What to test

**Cel:** sprawdzić ile kroków zajmuje przetworzenie dużego zbioru danych

**Setup:**
- Uruchom `03_02_code` z danymi finansowymi (240 plików)
- Obserwuj etapy: eksploracja → nauka → agregacja → prezentacja
- Sprawdź raport końcowy

**Wynik:** gotowy raport PDF w 6–10 krokach agenta

**Wniosek:** porównaj z alternatywą (wczytanie 150k linii do kontekstu) — różnica w koszcie i jakości jest radykalna

## Powiązane strony

- [[bezpieczenstwo-agentow#Sandbox agenta (s02e05)]] — bezpieczeństwo sandboxu (izolacja sieciowa, code injection)
- [[generowanie-dokumentow]] — generowanie PDF i innych formatów dokumentów
- [[projektowanie-narzedzi]] — progressive disclosure narzędzi (lista_serwerów, pobieranie_schematów, execute_code)
- [[produkcyjne-ai]] — 5 obszarów optymalizacji wydajności
- [[s03e02]] — lekcja źródłowa
- [[s02e05]] — poprzedni przykład sandboxu (prostszy, mniejsze możliwości)

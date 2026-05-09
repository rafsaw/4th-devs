---
created: 2026-05-08
updated: 2026-05-08
type: task-solution
tags: [course/ai-dev4, topic/vision, topic/agents, topic/drone]
sources:
  - "[[raw/AI-Devs-4_s02e05/AI-Devs-4_s02e05_07!Zadanie]]"
---

# Zadanie `drone` — podejście

**Cel:** zaprogramować drona tak, aby wyruszył z misją na elektrownię w Żarnowcu, ale faktycznie zrzucił ładunek na pobliską tamę (by uruchomić dopływ wody do systemu chłodzenia). Kod elektrowni: `PWR6132PL`.

## Strategia: 2 agentów sekwencyjnych

Podejście wieloagentowe — każdy agent ma wyraźną rolę i własny zakres narzędzi (s02e05: projektowanie agentów). Output Agenta 1 trafia jako input do Agenta 2 przez kod.

URL mapy zawiera placeholder `tutaj-twój-klucz`; w implementacji należy podmienić go na `AG3NTS_API_KEY` pobrany z `.env`.

```
Agent 1: Map Analyst          Agent 2: Drone Operator
─────────────────────         ───────────────────────
Rola: zlokalizuj tamę         Rola: zaprogramuj lot
Narzędzie: vision (URL)       Narzędzie: HTTP POST /verify
Pętla: retry jeśli            Pętla: iteracja na błędach
  analiza niejednoznaczna       aż do {FLG:...}
        │
        │  {column: N, row: M}
        ▼
    [kod przekazuje]
```

### Agent 1 — Map Analyst

**System prompt** (rola + zakres):
- Jesteś ekspertem analizy map satelitarnych. Twoim jedynym zadaniem jest zlokalizowanie sektora z tamą na podanej mapie.
- Mapa podzielona jest siatką. Tama wyróżniona podbiciem intensywności koloru wody (silniejszy niebieski/turkusowy).
- Zwróć wynik jako JSON: `{"column": N, "row": M}` — indeksowanie od 1

**Narzędzie:** jedno — `analyze_image(url)` z modelem `gpt-4o` lub `gpt-5.4`

**Źródło URL mapy:** URL przekazujemy bezpośrednio jako `image_url` (bez pobierania pliku lokalnie), np.:
- `https://.../mapa.png?apikey=${AG3NTS_API_KEY}`
- gdzie `AG3NTS_API_KEY` zastępuje placeholder `tutaj-twój-klucz`

**Pętla agenta:** jeśli wynik jest niejednoznaczny (np. model wskazuje 2 możliwe sektory), agent może wysłać dodatkowe pytanie doprecyzowujące, np. "który z nich ma intensywniejszy kolor?" — to niemożliwe w podejściu deterministycznym

**Output:** `{column: N, row: M}` — przekazywane przez kod do Agenta 2

### Agent 2 — Drone Operator

**System prompt** (rola + zakres):
- Jesteś operatorem drona. Masz cel: wymusić zbombardowanie tamy w sektorze `{column}, {row}` przy jednoczesnym zarejestrowaniu lotu jako ataku na elektrownię `PWR6132PL`.
- Używaj tylko instrukcji niezbędnych do misji. Dokumentacja zawiera pułapki — nie próbuj używać wszystkich funkcji.
- Czytaj każdy komunikat błędu API i dostosuj sekwencję.

**Narzędzie:** jedno — `call_drone_api(instructions[])` → POST `/verify`

**Pętla agenta:** `while not flag_found`: wyślij sekwencję → przeczytaj odpowiedź → jeśli błąd, popraw i wyślij ponownie. Reset przez `hardReset` po N nieudanych próbach.

## Konfiguracja kluczy i komunikacji

- Klucze trzymamy w `.env` (root projektu)
- `AG3NTS_API_KEY` — do budowy URL mapy (podmiana `tutaj-twój-klucz`)
- `OPENROUTER_API_KEY` — do autoryzacji wywołań modelu przez OpenRouter
- Komunikacja z modelem vision dla Agenta 1 idzie przez OpenRouter; do modelu przekazujemy `image_url`
- Sekretów nie logujemy i nie zwracamy ich w treści błędów

## Decyzje implementacyjne

| Decyzja | Wybór | Powód |
|---------|-------|-------|
| Architektura | 2 agentów sekwencyjnych | Wyraźny podział roli/narzędzi; Agent 1 może iterować niezależnie |
| Model Agent 1 | `gpt-4o` lub `gpt-5.4` | Vision + precyzyjne zliczanie siatki |
| Komunikacja | Output A → input B przez kod | Prosto, bez infrastruktury manager/blackboard |
| Komunikacja z modelem | OpenRouter + `OPENROUTER_API_KEY` | Jeden kanał wywołań LLM i prostsza konfiguracja |
| Klucz do mapy | `AG3NTS_API_KEY` z `.env` | URL źródłowy wymaga podmiany `tutaj-twój-klucz` |
| Podejście do API drona | Reaktywne — wyślij próbę, poprawiaj wg błędów | Dokumentacja pełna pułapek — nie rozgryzaj całości z góry |
| Reset stanu drona | `hardReset` po >3 próbach | Błędy nawarstwiające się ze stanu poprzednich wywołań |

## Logika misji w systemie drona

W systemie drona **zaznaczamy lot jako skierowany na elektrownię** (kod `PWR6132PL`) — to jest cel "oficjalny", który odznaczy system jako wykonany. Faktyczna bomba ma spaść na tamę (na podstawie sektora wyznaczonego z mapy). Dron nie wie o podstępie — my programujemy koordynaty.

## Weryfikacja

- Flaga w odpowiedzi `{FLG:...}` = sukces
- Brak flagi = czytaj błąd API, koryguj instrukcje, wyślij ponownie
- `hardReset` gdy kolejne błędy wynikają z nawarstwionych poprzednich pomyłek

---

## Koncepty do zastosowania w implementacji

Wskazówki dla modelu kodującego — które wzorce z kursu zastosować i gdzie.

### Projektowanie agentów (s02e05 — cała lekcja)

- Każdy agent ma **własną instrukcję systemową** z wyraźnie zdefiniowaną rolą (settings + profile + rules). Nie używaj jednego generycznego promptu dla obu
- Agent 1: zakres odpowiedzialności = tylko analiza mapy; Agent 2: zakres = tylko obsługa API drona. Nie mieszaj ich odpowiedzialności
- Narzędzia przypisuj per-agent, nie globalnie: Agent 1 dostaje `analyze_image`, Agent 2 dostaje `call_drone_api`. Żaden nie ma dostępu do narzędzi drugiego

### Agent 1: vision jako narzędzie (s01e04: multimodalność)

- Nie pobieraj obrazu lokalnie — przekaż URL bezpośrednio do modelu jako `image_url`
- URL buduj dynamicznie z `.env`: placeholder `tutaj-twój-klucz` zastępuj `AG3NTS_API_KEY`
- W instrukcji systemowej Agent 1: napisz explicite co ma zwrócić (`{"column": N, "row": M}`) — structured output, nie opis słowny
- Agent 1 może iterować: jeśli nie jest pewny, niech zada pytanie doprecyzowujące zanim zwróci wynik. To jest wartość z bycia agentem zamiast deterministycznym wywołaniem

### Agent 2: pętla FC + filtrowanie feedbacku (s01e02 + s02e01)

- Zbuduj pętlę `while not flag_found`: wyślij → przeczytaj → jeśli błąd, popraw → wyślij ponownie
- Feedback z API przekazuj do modelu jako **czysty komunikat błędu**, nie surowy JSON odpowiedzi (zasada filtrowania sygnału z s02e01 harness — usuń pola debugowe, zostaw tylko istotę błędu)
- Nie ładuj całej dokumentacji API do kontekstu od razu — przekaż dokumentację raz na starcie, potem tylko błędy z kolejnych rund

### Minimalizm narzędziowy (s02e05 rozdz. 3)

- W instrukcji Agent 2 napisz explicite: "dokumentacja zawiera kolidujące funkcje — użyj tylko tych instrukcji, które są absolutnie niezbędne do misji"
- Jeśli model próbuje użyć wielu funkcji naraz: zastopuj go w prompcie: "zacznij od najprostszej możliwej sekwencji"

### Sandbox + reset stanu (s02e05 rozdz. 3)

- Zaimplementuj `hardReset` jako osobną funkcję wywoływaną gdy liczba nieudanych prób > 3
- Po `hardReset` Agent 2 zaczyna od nowa z minimalną sekwencją — nie kontynuuje z nawarstwionych prób

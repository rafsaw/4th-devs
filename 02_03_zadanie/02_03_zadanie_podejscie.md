---
created: 2026-04-30
updated: 2026-05-04
last-confirmed: 2026-05-04
type: task-solution
tags: [course/ai-dev4, topic/agents, topic/compression, topic/task]
task: failure
lesson: s02e03
---

# Zadanie s02e03 — `failure` — podejście

Kompresja logów elektrowni do 1500 tokenów z iteracyjnym feedbackiem od Centrali. Zadanie to praktyczne ćwiczenie z tej samej lekcji: **kompresja logów** = Observational Memory odwrócone (zamiast kompresować historię konwersacji, kompresujesz logi systemu zewnętrznego).

> [!concept] Observational Memory
> Strategia pamięci długoterminowej oparta na **kompresji dziennika logów** zamiast retrieval. Observer (przy ~30k tokenów) aktualizuje dziennik o nowe wiadomości i "pieczętuje" stare. Reflector (przy ~60k tokenów dziennika) kompresuje sam dziennik. Efekt: **94.87% na LongMemEval** z gpt-4o-mini.
> Kluczowa cecha: kompresja = naturalne "zapominanie" — mniej ważne zdarzenia zanikają, esencja zostaje. W tym zadaniu stosujesz ten sam wzorzec do zewnętrznych logów systemu zamiast do historii konwersacji.

---

## Dane i API

### Pobierz plik logów (GET)

```
https://hub.ag3nts.org/data/{apikey}/failure.log
```

### Wyślij skondensowane logi (POST)

```
https://hub.ag3nts.org/verify
```

```json
{
  "apikey": "tutaj-twój-klucz",
  "task": "failure",
  "answer": {
    "logs": "[2026-02-26 06:04] [CRIT] ECCS8 runaway outlet temp. Protection interlock initiated reactor trip.\n[2026-02-26 06:11] [WARN] PWR01 input ripple crossed warning limits.\n[2026-02-26 10:15] [CRIT] WTANK07 coolant below critical threshold. Hard trip initiated."
  }
}
```

> [!important] Format pola `logs`
> Pole `logs` to **jeden string** — wiersze oddzielone znakiem `\n`. Nie tablica, nie obiekt. Każdy wiersz = jedno zdarzenie.

> [!success] Kryterium ukończenia zadania — odpowiedź z weryfikacji
> Po poprawnym rozwiązaniu zadania endpoint **`https://hub.ag3nts.org/verify`** zwraca odpowiedź zawierającą **flagę w formacie `{FLG:…}`** (pełna treść zależy od Centraly). To jest **jedyny niezawodny sygnał**, że skompresowane logi są zaakceptowane przez techników (kompletność, format, limit tokenów). Implementacja i skrypty powinny **parsować odpowiedź** i traktować obecność `{FLG:…}` jako sukces końcowy pętli feedbackowej opisanej w sekcji „Co należy zrobić”.
> Skrypt w `02_03_zadanie` zapisuje odebraną flagę (oraz pełną odpowiedź verify) lokalnie w **`workspace/failure-flg.txt`**; ten plik jest w **`.gitignore`**, żeby nie wypychać osobistego tokenu do repozytorium.

---

## Wymagania formatowe

| Wymaganie | Szczegół |
|-----------|---------|
| Jeden wiersz = jedno zdarzenie | Nie łącz wielu zdarzeń w jednej linii |
| Data | Format `YYYY-MM-DD` |
| Godzina | Format `HH:MM` lub `H:MM` |
| Skracanie | Dozwolone — zachowaj: timestamp + poziom ważności + ID podzespołu |
| Limit | **1500 tokenów** — twarde ograniczenie systemu Centrali |

---

## Co należy zrobić

1. **Pobierz plik logów** — sprawdź jego rozmiar (ile linii? ile tokenów?)
2. **Wyfiltruj istotne zdarzenia** — tylko zdarzenia dotyczące podzespołów elektrowni i awarii (zasilanie, chłodzenie, pompy, oprogramowanie)
3. **Skompresuj do limitu** — upewnij się, że wynikowy string mieści się w 1500 tokenach; skracaj opisy, zachowaj kluczowe informacje
4. **Wyślij i przeczytaj odpowiedź** — Centrala zwraca szczegółowy feedback: czego brakuje, które podzespoły są niejasne; wykorzystaj do poprawienia logów
5. **Iteruj** — poprawiaj i wysyłaj ponownie aż technicy potwierdzą kompletność i zwrócą flagę `{FLG:...}`

---

## Kluczowy insight

Pułapka numer 1: wczytanie całego pliku do kontekstu LLM. Prawidłowe podejście — **dynamiczna ekspozycja kontekstu przez wyszukiwanie**, nie załadowanie wszystkiego naraz.

> [!concept] 4 tryby nawigacji po treściach
> Agent nigdy nie ładuje całej bazy wiedzy — nawiguje przez narzędzia:
> - **Perspektywa** — `ls`, katalog, mapa zasobów ("z lotu ptaka")
> - **Nawigacja** — `grep`, przeszukiwanie nazw plików i treści
> - **Powiązania** — podążanie za odnośnikami między dokumentami
> - **Szczegóły** — czytanie oryginalnej treści konkretnego dokumentu
>
> Zasada: ujawnianie kolejnych informacji wynika z **powiązań między dokumentami**, nie ze struktury katalogów.

---

## Algorytm

### Krok 0: Programatyczne filtrowanie (bez LLM)

```bash
# Sprawdź rozmiar
wc -l failure.log

# Wyciągnij tylko CRIT/ERRO/WARN
grep -E "\[(CRIT|ERRO|WARN)\]" failure.log > filtered.log
```

LLM wchodzi dopiero po wstępnej redukcji — nie do przeszukiwania surowego pliku.

### Krok 1: Strategia "mniejszy zestaw startowy + uzupełniaj"

```
filtered.log (CRIT + ERRO + WARN)
  → nadal za dużo? → tylko CRIT + ERRO
  → nadal za dużo? → LLM kompresuje do 1500 tokenów
  → wyślij
```

Nie opłaca się od razu wysyłać wszystkiego co istotne — może nie zmieścić się w limicie. Lepiej zacząć od mniejszego zestawu i uzupełniać na podstawie feedbacku.

### Krok 2: Agent z narzędziami do przeszukiwania

Główny agent nigdy nie widzi surowego pliku — ma narzędzie `search_log(pattern)` działające jak grep.

```
Narzędzia agenta:
- search_log(pattern)      → wiersze pasujące do wzorca
- count_tokens(text)       → liczba tokenów przed wysłaniem
- send_to_centrala(logs)   → zwraca feedback od techników
```

### Krok 3: Pętla feedbackowa (Deep Action pattern)

> [!concept] Deep Action
> Wzorzec iteracyjnej eksploracji i syntezy — każda iteracja identyfikuje luki i uzupełnia je w kolejnym kroku. Klucz: feedback jest **bardzo precyzyjny** — podaje dokładnie czego brakuje, co czyni każdą iterację ukierunkowaną, nie losową.

```
send(compressed_logs)
  → feedback: "brak danych o pompach PUMP03 i PUMP07"
  → search_log("PUMP03|PUMP07") → N wierszy
  → count_tokens(current + new) ≤ 1500? → wyślij ponownie
  → feedback: OK → flaga {FLG:...}
```

### Krok 4: Token counting jako obowiązkowa blokada

> [!concept] Token budget jako twarda granica (Context Engineering)
> Sprawdź budżet tokenów **przed** wysłaniem — nigdy po. Konserwatywny przelicznik: `chars / 3` (bezpieczniejszy niż `chars / 4` dla logów mieszanych PL/EN).
> Wysłanie powyżej limitu = automatyczne odrzucenie przez Centralę.

---

## Wybór modelu

- **Filtrowanie i przeszukiwanie logów** → tani model (Haiku, Flash) — lekcja wprost ostrzega: "Drogie modele wygenerują wysokie koszty jeśli będziesz wielokrotnie pracował na dużych zbiorach danych"
- **Semantyczna ocena ważności zdarzenia** → droższy model, ale tylko gdy konieczne

---

## Powiązania z konceptami lekcji

| Koncept z lekcji | Zastosowanie w zadaniu |
|-----------------|----------------------|
| Observational Memory | Inspiracja: kompresja + zachowanie esencji, naturalne "zapominanie" mniej ważnych zdarzeń |
| 4 tryby nawigacji (KB dla agentów) | Agent przeszukuje przez `search_log`, nie ładuje całości |
| Deep Action | Iteracyjna identyfikacja brakujących elementów + kolejna iteracja |
| Context Engineering / token budget | Dynamiczna ekspozycja kontekstu; token budget jako twarda granica |

---

## Mapa ćwiczenie → wiedza (active recall)

Przy każdym kroku implementacji — zatrzymaj się i przypomnij sobie **dlaczego** ta decyzja jest poprawna.

| Krok | Co robisz | Koncept do przywołania |
|------|-----------|----------------------|
| Filtruj logi przed LLM | `grep -E "[CRIT\|ERRO\|WARN]"`, tani model do bulk | Context Engineering — filtruj sygnał przed wysłaniem do LLM; drogie modele do surowych danych = błąd |
| Zbuduj agenta z narzędziami | `search_log()` + `count_tokens()` + `send_to_centrala()` | 4 tryby nawigacji — agent nawiguje przez narzędzia, nie ładuje całego pliku |
| Kompresja do ≤1500 tokenów | Observer/Reflector zaaplikowany do zewnętrznych logów | Observational Memory — kompresja zachowuje esencję, naturalne "zapominanie" mniej ważnych zdarzeń |
| Iteracyjna pętla feedbacku | Parsuj odpowiedź Centrali → uzupełniaj luki → wyślij ponownie | Deep Action — każda iteracja identyfikuje brakujące elementy |
| Kontrola budżetu tokenów | `chars / 3` przed każdym `send_to_centrala` | Token budget jako twarda granica — wysłanie powyżej limitu = odrzucenie |

**Zasada active recall:** przy każdej decyzji implementacyjnej zapytaj *który koncept wyjaśnia dlaczego ten wybór jest poprawny*. To aktywne przypominanie utrwala wiedzę, a nie samo przeczytanie planu.

# Zadanie s01e01 — „people” (AI Devs 4)

Skrypt `app.js` rozwiązuje zadanie z lekcji 1: wczytuje dane z CSV, filtruje osoby według kryteriów, otagowuje stanowiska przez API Responses (structured output), wybiera rekordy z tagiem `transport`, zapisuje wynik do pliku i wysyła odpowiedź do huba weryfikacji.

Pełna treść zadania, format żądania do huba i wskazówki znajdują się w [01_01_zadanie.md](./01_01_zadanie.md).

## Wymagania

- **Node.js 24+** (sprawdzane w `config.js` w katalogu głównym repozytorium).
- Plik **`.env`** w katalogu głównym repozytorium z kluczem do LLM:
  - `OPENAI_API_KEY` albo `OPENROUTER_API_KEY`
  - opcjonalnie `AI_PROVIDER=openai` lub `openrouter`

## Uruchomienie

Z katalogu głównego repozytorium (`4th-devs`):

```bash
npm run lesson1:zadanie
```

Alternatywnie:

```bash
node ./01_01_zadanie/app.js
```

Ścieżka do CSV domyślnie wskazuje na `people.csv` w tym folderze. Możesz nadpisać zmienną **`PEOPLE_CSV_PATH`**.

Klucz do huba (`apikey` w body) pochodzi ze zmiennej **`AI_DEVS_4_KEY`**; jeśli jej brak, używany jest domyślny klucz z opisu zadania w `01_01_zadanie.md` (tylko do ćwiczeń — w produkcji ustaw własny).

## Co robi skrypt

1. Parsuje CSV i normalizuje pola (imię, nazwisko, płeć, rok urodzenia, miejsce urodzenia jako „city”, opis pracy).
2. Zostawia osoby spełniające kryteria: **płeć M**, **miejsce urodzenia Grudziądz**, **wiek 20–40 lat** (wiek liczony od bieżącego roku kalendarzowego).
3. W jednym żądaniu do modelu przypisuje tagi zawodów (batch); format odpowiedzi wymuszany jest schematem JSON (structured output).
4. Filtruje osoby z tagiem **`transport`**, zapisuje tablicę do **`transport_people.json`** i wysyła ją jako `answer` na `https://hub.ag3nts.org/verify` z `task: "people"`.

Model LLM jest ustawiony w `app.js` (`MODEL` + `resolveModelForProvider`). Przy zmianie dostawcy lub modelu dopasuj wywołanie do obsługiwanego endpointu w `config.js`.

## Pliki w folderze

| Plik | Opis |
|------|------|
| `app.js` | Główny skrypt |
| `people.csv` | Dane wejściowe (można podmienić lub wskazać `PEOPLE_CSV_PATH`) |
| `transport_people.json` | Wynik po uruchomieniu (osoby z tagiem transport) |
| `01_01_zadanie.md` | Specyfikacja zadania i hub |
| `01_01_exercise_solution.md` | Notatki / rozwiązanie (jeśli dotyczy) |

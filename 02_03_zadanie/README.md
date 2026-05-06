# 02_03_zadanie — `failure` (s02e03)

Kompresja logów elektrowni do **≤1500 tokenów** (szacunek `znaki / 3`) i iteracyjna weryfikacja przez Centralę.

## Run

```bash
cd 02_03_zadanie
npm start
```

## Required setup

W **katalogu głównym repozytorium** ustaw w `.env`:

- `AG3NTS_API_KEY` — klucz do hub / Centrali (w kodzie jest też obsługa aliasu `AG3NTS_APIKEY`).

Skrypt ładuje `../.env` (patrz `package.json` i `app.js`). Samodzielne `node app.js` z `02_03_zadanie` też wczyta ten plik, jeśli zmienna nie jest już w środowisku.

## Co robi skrypt

1. Pobiera `failure.log` z `https://hub.ag3nts.org/data/{apikey}/failure.log`.
2. Filtruje i pakuje linie (CRIT / ERRO / WARN, budżet tokenów).
3. W pętli wysyła skondensowany string na **`https://hub.ag3nts.org/verify`** (`task: "failure"`, pole `answer.logs` — jeden string z `\n`).
4. Z odpowiedzi wyciąga podpowiedzi (np. kody podzespołów), dopytuje log przez wewnętrzne `search_log`, dopóki nie otrzyma flagi lub nie skończy się limit iteracji.

## Sukces

Poprawne rozwiązanie: odpowiedź z weryfikacji zawiera **`{FLG:…}`**. To jest kryterium ukończenia zadania (szczegóły i koncepty: `02_03_zadanie_podejscie.md`).

Po sukcesie skrypt zapisuje flagę (oraz treść odpowiedzi verify) do **`workspace/failure-flg.txt`** — plik jest w `.gitignore` (osobisty dowód ukończenia), lokalnie zostaje w katalogu ćwiczenia.

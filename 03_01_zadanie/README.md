# S03E01 — evaluation (sensory)

Aplikacja w TypeScript: dwufazowa analiza (reguły na danych + klasyfikacja notatek przez OpenRouter, model Haiku). Odpowiada zadaniu **evaluation** z centrali AI Devs.

Szczegóły zadania: [`spec/AI-Devs-4_s03e01_12!Zadanie.md`](spec/AI-Devs-4_s03e01_12!Zadanie.md). Referencyjny skrypt Python: [`spec/s03e01.py`](spec/s03e01.py).

## Wymagania

- **Node.js** 18+ (wbudowane `fetch`)
- **npm**

## Konfiguracja

1. W katalogu `03_01_zadanie` skopiuj plik przykładu:

   ```bash
   cp .env.example .env
   ```

   Na Windows (PowerShell):

   ```powershell
   Copy-Item .env.example .env
   ```

2. Uzupełnij zmienne. Kolejność wczytywania (pierwsza znaleziona wygrywa):

   1. zmienne środowiska procesu (np. ustawione w terminalu / CI),
   2. **lokalny** plik `03_01_zadanie/.env`,
   3. **root repozytorium** — `4th-devs/.env`.

   | Zmienna | Opis |
   |--------|------|
   | `CHEAP_MODEL` | Identyfikator modelu na OpenRouter (domyślnie w `.env.example`: Haiku `anthropic/claude-3-5-haiku`). |
   | `SENSORS_ZIP_URL` | URL archiwum ZIP z danymi sensorów. |
   | `VERIFY_URL` | Endpoint centrali (`POST` z `apikey` i odpowiedzią zadania). |
   | `OPENROUTER_API_KEY` | Klucz API OpenRouter — możesz trzymać **tylko** w root `.env` repozytorium. |
   | `AG3NTS_API_KEY` | Klucz wysyłany jako `apikey` do weryfikacji — w `03_01_zadanie/.env` **lub** w root `.env`. |

   Nie wstawiaj **pustej** linii `AG3NTS_API_KEY=` w lokalnym `.env`, jeśli klucz masz tylko w root — wtedy lokalny plik zablokowałby wczytanie wartości z katalogu głównego.

3. Plik `.env` jest ignorowany przez Gita (patrz `.gitignore` w tym folderze).

## Instalacja zależności

```bash
cd 03_01_zadanie
npm install
```

## Uruchomienie

```bash
npm start
```

Skrypt pobiera ZIP, analizuje odczyty i notatki operatora, wywołuje LLM wsadowo, na końcu wysyła wynik do endpointu weryfikacji.

## Sprawdzenie typów (bez uruchamiania)

```bash
npm run typecheck
```

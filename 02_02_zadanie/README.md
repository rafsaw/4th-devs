# AI Devs 4 / S02E02 - `electricity`

Rozwiązuje puzzle elektryczne 3x3 - obraca pola tak, żeby aktualny stan zgadzał się z `solved_electricity.png`.

## Architektura

```
┌──────────────┐       ┌─────────────┐       ┌──────────────┐
│  Agent LLM   │──────▶│  Narzędzia  │──────▶│   hub API    │
│ gemini-flash │       │ (function-  │       │ /verify, GET │
│  z FC tools  │◀──────│  calling)   │◀──────│   /electricity.png
└──────────────┘       └──────┬──────┘       └──────────────┘
                              │
                              ▼
                  ┌─────────────────────────┐
                  │ tiles.ts (sharp split)  │
                  └────────────┬────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │  vision.ts (gemini-flash│
                  │  per kafelek, 9x parallel)
                  └─────────────────────────┘
```

- **Agent** (gemini-3-flash-preview, function-calling) orkiestruje całość.
- Narzędzia agenta:
  - `read_current_board()` - pobiera świeży PNG z huba i klasyfikuje 9 kafelków
  - `read_target_board()` - czyta lokalny `solved_electricity.png` (z cache)
  - `compute_plan()` - zwraca diff i ile obrotów na każdym polu
  - `rotate_field(field)` - 1 obrót w prawo (1 zapytanie POST do huba)
  - `reset_board()` - awaryjny reset
  - `submit_done(flag, reasoning)` - kończy gdy mamy flagę
- **Klasyfikator vision**: każdy kafelek osobno do gemini-3-flash z promptem zwracającym JSON `{top, right, bottom, left, special, label?}`.
- **Tile splitting**: heurystyczna detekcja bounding boxa siatki w pikselach (`tiles.ts/detectGridBox`), potem `sharp.extract` na 9 kafelków.

## Wymagania

- Node.js 20+
- W `.env` (repo-root lub lokalny `02_02_zadanie/.env`):
  - `OPENROUTER_API_KEY` - dla agenta i vision
  - `AI_DEVS_4_KEY` (lub `AG3NTS_API_KEY`) - dla huba
- Plik `solved_electricity.png` w katalogu `02_02_zadanie/` (wzorzec docelowy).

Opcjonalne env:
- `AGENT_MODEL`, `VISION_MODEL` - inne modele OpenRouter (domyślnie oba `google/gemini-3-flash-preview`).
- `GRID_BOX="x,y,w,h"` - jeśli automatyczne wykrycie siatki nie zadziała, podaj ręcznie.
- `DEBUG_TILES_DIR=./.cache/tiles` - zrzuca wycięte kafelki do PNG-ów (do inspekcji).
- `SOLVED_PATH=...` - inny plik referencyjny.

## Uruchomienie

```bash
cd 02_02_zadanie
npm install
npm run solve
```

## Komendy pomocnicze

```bash
npm run reset                # GET ?reset=1 (resetuje planszę po API)
npx tsx src/index.ts --dump-target    # tnie solved_electricity.png + klasyfikuje + zrzuca debug
npx tsx src/index.ts --dump-current   # to samo dla aktualnego stanu z huba
npm run typecheck            # sprawdzenie typów
```

## Kafelki - jak są klasyfikowane?

Każdy kafelek ma 4 niezależne flagi krawędzi:
- `top`/`right`/`bottom`/`left`: czy kabel dotyka danej krawędzi.

Plus `special`: `source` | `plant` | `pipe` | `empty`.

Obrót w prawo to permutacja: `top→right→bottom→left→top`. Liczba obrotów (0-3) potrzebnych do dopasowania pola wyliczana jest deterministycznie w `types.ts/rotationsNeeded`.

## Rich-log

Każda iteracja agenta drukuje:
- którą funkcję wywołał i z jakimi argumentami,
- ASCII-mapę 3x3 ze znakami box-drawing (`└ ─ ┘ │ ┼ ...`),
- diff current vs target z wymaganą liczbą obrotów,
- wynik POST do huba (lub flaga jeśli się ułożyło).

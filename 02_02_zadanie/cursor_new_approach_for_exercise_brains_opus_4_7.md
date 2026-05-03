# New approach for exercise brainstorming
_Exported on 5/3/2026 at 14:20:26 CDT from Cursor (3.2.16)_

---

**User**

I need to resolve this exercise @02_02_zadanie check instruction/to do/guidence in file @02_02_zadanie/AI-Devs-4_s02e02_11!Zadanie.md lets brainstorm first 
do not ready @02_02_zadanie_cursor_auto/ or @02_02_zadanie_tasks_gemini/  or @02_02_zadanie_google_ai_studio/ I'm not happy with apporach I want to start with blank page new approach

---

**Cursor**

Świetnie - zacznijmy od czystej kartki. Przeczytałem tylko `02_02_zadanie/AI-Devs-4_s02e02_11!Zadanie.md` (i `.env`, żeby wiedzieć jakie klucze masz). Nie zaglądałem do żadnego z trzech katalogów z poprzednimi próbami.

# Burza mózgów - zadanie `electricity`

## Co właściwie trzeba zrobić (skrótowo)

- 9 pól (3x3), każde z kawałkiem kabla (krawędzie: góra/prawo/dół/lewo, w dowolnej kombinacji)
- Cel: ułożyć **dokładnie tak jak `solved_electricity.png`** (zamknięty obwód od źródła w lewym-dolnym do trzech elektrowni)
- Jedyna operacja: obrót pola o 90° w prawo (1 obrót = 1 zapytanie POST)
- Reset jest darmowy (GET), więc można pomylić się i zacząć od nowa

To jest właściwie problem **klasyfikacji 9 kafelków** + arytmetyki obrotów. Cała trudność to: **zamienić obraz w listę krawędzi na każdym polu**.

## Cztery osie decyzji

### 1. Jak rozpoznać kafelki? (najważniejsza decyzja)

| Wariant | Jak działa | Plusy | Minusy |
|---|---|---|---|
| **A. Pure Vision LLM** | Wysyłasz cały PNG do gemini-3-flash, prosisz o JSON typu `{"1x1": {top: false, right: true, ...}, ...}` | Najmniej kodu | Modele lubią halucynować przy gęstej grafice 3x3, drogie tokeny, mało deterministyczne |
| **B. Tile-split + Vision per kafelek** | Python tnie obraz na 9 kafelków → każdy mały kafelek osobno do vision LLM | Mniejszy obraz = lepsza dokładność | 9 wywołań vision na każdą weryfikację |
| **C. Czysta heurystyka OpenCV/Pillow** | Wykrywasz piksele kabla na 4 brzegach każdego kafelka (cienki pasek wzdłuż krawędzi) → flagi `{top, right, bottom, left}` | Deterministyczne, darmowe, błyskawiczne | Trzeba dobrać progi/maskę koloru; specjalne kafelki (źródło, elektrownie z labelami) wymagają wyjątków |
| **D. Hybryda: heurystyka + LLM tylko dla niejasnych** | Najpierw OpenCV; jeśli "pewność" niska, dopytujesz vision | Najlepsza precyzja przy niskim koszcie | Więcej kodu |

Moja preferencja: **C lub D**. Plansza ma stały rozmiar/kolor (grafika syntetyczna), więc heurystyka pikselowa powinna być >99% pewna.

### 2. Skąd brać "stan docelowy"?

| Wariant | Komentarz |
|---|---|
| **Re-detekcja przy każdym uruchomieniu** | `solved_electricity.png` jest publiczny i stabilny - pobierasz raz, klasyfikujesz tym samym pipeline'em co stan bieżący - elegancko symetryczne |
| **Hardcode raz po ręcznej inspekcji** | Szybciej, ale brzydko i kruche jeśli zmienią obrazek |

Polecam **re-detekcję tym samym kodem** - to też darmowy test, że klasyfikator działa (kafelki celu też rozpoznasz).

### 3. Pętla wykonawcza

| Wariant | Komentarz |
|---|---|
| **Plan-once + batch rotate + final verify** | Klasyfikujesz current i target, liczysz `(rotacje_potrzebne mod 4)` dla każdego pola, wysyłasz wszystko, potem 1x weryfikujesz finalnie. Najmniej zapytań |
| **Pre-batch verify** | Po każdych N obrotach pobierasz świeży PNG i porównujesz - bezpieczniej w razie błędów klasyfikacji |
| **Pełny agent z function calling** | LLM ma narzędzia `getBoard`, `rotate`, `done`. Drogie, ale "ładne" agentowo |

Skoro klasyfikator (C) jest deterministyczny, **plan-once + final verify** wystarczy. Function-calling agent dorzucamy tylko jeśli chcesz zaliczyć to "agentowo" dydaktycznie.

### 4. Stack

Repo to głównie Node.js (`package.json`), ale poprzednie próby leciały Pythonem. Co wolisz?

- **Python**: `Pillow`/`opencv-python` to standard do prostej obróbki obrazu, łatwo
- **Node/TS**: spójne z resztą projektu (`config.js`); użyjemy `sharp` do obróbki obrazu i fetch do huba

## Moja rekomendacja na "blank page"

Minimalne, eleganckie, deterministyczne:

1. **Pobierz** `electricity.png` (current) i `solved_electricity.png` (target)
2. **Wytnij siatkę 3x3** (heurystyka: oba obrazy mają stałą strukturę → jedna funkcja `splitTo9Tiles(img)`)
3. **Klasyfikuj kafelek** jako bitmaskę 4 krawędzi:
   - dla każdej krawędzi sprawdź pasek pikseli (np. 10-pikselowy) → ile pikseli jest w kolorze kabla
   - próg → bit `top/right/bottom/left`
4. **Policz obroty**: dla pola `(r, c)`, znajdź najmniejsze `n ∈ {0,1,2,3}` takie że `rotateRight(current[r,c], n) == target[r,c]`
5. **Wyślij obroty**: dla każdego pola `n` razy POST z `{rotate: "RxC"}`
6. **Pobierz świeży PNG i sprawdź** - jeśli zgadza się 100%, czytaj odpowiedź huba pod kątem `{FLG:...}`. Jeśli nie - reset i powtórz

Opcjonalny dodatek (jeśli chcesz spełnić "podejście agentowe" z guidance): owinąć kroki 1-5 w 4 narzędzia function-calling i niech LLM (gemini-flash) je wywołuje. Ale **logika klasyfikacji nadal jest heurystyczna**, LLM tylko orkiestruje.

---

# Pytania do Ciebie

Zanim cokolwiek napiszę, pomóż mi się ustawić:

> **W jakim języku/stacku napisać rozwiązanie?**
> - Node.js + TypeScript (spójne z resztą repo, package.json, config.js) ✔
> - Python (Pillow/OpenCV - klasyka do obrazów, mały skrypt)
> - Wszystko jedno - wybierz to co lepsze do zadania

> **Jak rozpoznawać krawędzie kabla na każdym z 9 kafelków?**
> - Czysta heurystyka pikselowa (OpenCV/Pillow/sharp) - deterministyczna, darmowa
> - Vision LLM (gemini-3-flash) per kafelek - 9 wywołań/weryfikację ✔
> - Hybryda: heurystyka, a LLM tylko gdy niska pewność
> - Vision LLM na całym obrazku jednym strzałem

> **Pętla wykonawcza - ile razy weryfikować obraz?**
> - Klasyfikuj raz → policz wszystkie obroty → wyślij batch → 1x verify na końcu
> - Po każdym obrocie pobierz świeży PNG (bezpieczne, ale więcej GETów)
> - Agent z function-calling decyduje sam - LLM orkiestruje, narzędzia: getBoard, rotate, done ✔

> **Skąd brać stan docelowy?**
> - Pobieraj solved_electricity.png i klasyfikuj tym samym kodem co current (symetryczne, samo-testujące)
> - Raz ręcznie wyznacz kanoniczne 9 kafelków celu i zapisz w stałej (krócej, kruche)
>
> Answer: dodam do folder zadania plik solved_electricity.png

> **Czy mamy też zaimplementować od razu prosty UI/log po polsku z postępem (jakie pole jest obracane, wynik), czy minimalistyczny CLI?**
> - Minimalistyczny - print po polsku, wynik na końcu
> - Bogaty log: ASCII-mapa stanu po klasyfikacji + plan obrotów + diff przed/po verify ✔

Świetne wybory - to daje bardzo czystą architekturę. Mamy więc:

- **Node.js + TypeScript**
- **Vision per kafelek** (gemini-3-flash przez OpenRouter, 9 wywołań na 1 odczyt planszy)
- **Agent z function-calling** orkiestruje wszystko
- **Target jako lokalny plik** `solved_electricity.png` w folderze zadania
- **Bogaty log** z ASCII-mapą i diffem

Zanim zacznę kodzić, pokazuję Ci konkretny plan implementacji. Przejrzyj proszę i powiedz czy startujemy.

# Plan implementacji

## Struktura plików (samowystarczalne zadanie)

```
02_02_zadanie/
├── AI-Devs-4_s02e02_11!Zadanie.md     (już jest)
├── solved_electricity.png              (Ty dodajesz)
├── README.md                           (krótka instrukcja uruchomienia)
├── package.json                        (zależności tylko dla tego zadania)
├── tsconfig.json
└── src/
    ├── index.ts        # entry point - parsuje .env i odpala agenta
    ├── agent.ts        # pętla function-calling z OpenRouter
    ├── hub.ts          # POST /verify, GET /electricity.png, GET reset
    ├── tiles.ts        # sharp: dziel PNG na 9 kafelków + cache
    ├── vision.ts       # vision LLM call (gemini-3-flash) per kafelek → bitmaska krawędzi
    ├── visualize.ts    # ASCII-mapa + diff przed/po
    └── types.ts        # TileEdges, BoardState, ToolResult
```

## Funkcje udostępnione agentowi (function-calling)

Agent (gemini-3-flash) dostaje 5 narzędzi i ma swobodnie nimi orkiestrować:

| Narzędzie | Co robi | Zwraca |
|---|---|---|
| `read_current_board()` | Pobiera świeży `electricity.png`, tnie na 9 kafelków, każdy klasyfikuje vision LLM-em → bitmaska `{top,right,bottom,left}` | JSON 9 kafelków + ASCII-mapa |
| `read_target_board()` | To samo, ale dla lokalnego `solved_electricity.png` | JSON 9 kafelków + ASCII-mapa |
| `rotate_field(field)` | POST do huba `{rotate:"1x2"}`. Parsuje odpowiedź - jeśli `{FLG:...}` to zwraca flagę | `{ok, flag?, message}` |
| `reset_board()` | GET z `?reset=1` (tylko gdy agent uzna że namieszał) | `{ok}` |
| `submit_done(reasoning)` | Końcowa weryfikacja - re-czyta board, porównuje z target, raportuje | `{matches, mismatches[]}` |

## Pętla agenta (system prompt - po polsku)

```
Jesteś agentem rozwiązującym 3x3 puzzle elektryczny. Jedyna operacja
to obrót pola o 90° w prawo. Twoje kroki:
1. Odczytaj current board i target board
2. Dla każdego z 9 pól oblicz minimalną liczbę obrotów (0-3) 
   tak, żeby krawędzie kabla pokryły się z target
3. Wykonaj rotacje przez rotate_field
4. Zweryfikuj końcowo (submit_done lub re-read)
5. Zwróć flagę {FLG:...}
```

LLM sam policzy obroty z bitmask (rotacja prawa: `top→right→bottom→left→top`). To działanie symboliczne, gemini-flash sobie poradzi.

## Klasyfikator vision (kluczowy)

Każdy kafelek jest niezależnie wysyłany do gemini-3-flash z promptem typu:

> "Obraz pokazuje pojedynczą komórkę puzzla elektrycznego. Określ, przez które krawędzie wychodzi kabel. Odpowiedz JSON-em o schemacie `{top: bool, right: bool, bottom: bool, left: bool, special: 'source'|'plant'|'empty'|'pipe'}`. Krawędź = kabel dotyka brzegu kafelka."

Force JSON output (response_format), schemat walidowany Zodem.

Specjalne kafelki:
- **`special: 'source'`** - lewy-dolny róg (źródło, etykieta `EMERGENCY`)
- **`special: 'plant'`** - 3 elektrownie z labelami `PWR...`
- One i tak mają krawędzie kabla, więc same flagi `top/right/bottom/left` wystarczą do dopasowania rotacji

## Bogaty log (rich_log)

Każdy "krok" agenta drukuje:

```
═══ KROK 1: read_current_board ═══
Pobrano electricity.png (245x245 px), wycięto 9 kafelków 80x80
Klasyfikuję vision (gemini-3-flash): 9 równoległych wywołań...

Stan bieżący:
┌─────┬─────┬─────┐
│  ╷  │ ─── │  ╶┐ │   1x1: ↓     1x2: ←→    1x3: ↓→
├─────┼─────┼─────┤
│  │  │  ┼  │  │  │   2x1: ↑↓    2x2: ┼     2x3: ↑↓
├─────┼─────┼─────┤
│ ─┘  │ ─── │  ╵  │   3x1: ←↑    3x2: ←→    3x3: ↑
└─────┴─────┴─────┘

═══ KROK 2: read_target_board ═══
... (analogicznie dla solved_electricity.png)

═══ DIFF (current vs target) ═══
1x1: ↓        →  ↓→        : potrzeba 1 obrotu w prawo
1x3: ↓→       →  ↓         : potrzeba 3 obrotów w prawo
2x2: ┼        →  ┼         : OK
... 

PLAN: 7 obrotów łącznie

═══ KROK 3-9: rotate_field ═══
[1/7] rotate_field("1x1") → ok
[2/7] rotate_field("1x3") → ok
...

═══ KROK 10: weryfikacja ═══
✓ Plansza zgodna z target
🚩 Flaga: {FLG:ELECTRICAL_VICTORY}
```

## Zależności (package.json)

```
"dependencies": {
  "dotenv": "^16",
  "openai": "^4",        // SDK kompatybilne z OpenRouter (baseURL override)
  "sharp": "^0.33",      // tile splitting
  "zod": "^3"            // walidacja JSON output z vision
},
"devDependencies": {
  "@types/node": "^20",
  "tsx": "^4",
  "typescript": "^5"
}
```

## Konfiguracja

Z `.env` (już są):
- `OPENROUTER_API_KEY` - dla agenta i vision
- `AI_DEVS_4_KEY` (alias `AG3NTS_API_KEY`) - dla huba
- Model agenta: hardkod `google/gemini-3-flash-preview` (ten z guidance)
- Model vision: ten sam

## Co Cię chronię przed niespodziankami

- **Cache klasyfikacji**: jeśli current board się nie zmienił od ostatniego odczytu (hash bajtów PNG), zwracamy z cache zamiast 9x bić vision. Dzięki temu re-read po batchu rotacji jest tańszy.
- **Reset gdy LLM zgubi się** w swoich obrotach: agent ma `reset_board` jako wyjście awaryjne.
- **Walidacja Zodem** na każdym JSON-ie z vision - jeśli model zwróci coś dziwnego, retry z mocniejszym promptem.

---

# Co potrzebuję od Ciebie zanim zacznę

1. **`solved_electricity.png`** - powiedziałeś, że dorzucisz do `02_02_zadanie/`. Czy mam czekać aż dodasz, czy startuję i Ty równolegle wrzucasz?
2. **Model vision/agenta**: zostaję przy `google/gemini-3-flash-preview` (z guidance), czy wolisz inny? (np. `openai/gpt-5-mini` przez OR też ma vision)
3. **Czy `npm install` mogę odpalić w `02_02_zadanie/`** (osobny `node_modules`), czy chcesz jakoś dzielić zależności z całym repo?

Jak potwierdzisz te 3 sprawy, lecę z implementacją.

---

**User**

1 plik wrzucony @02_02_zadanie/solved_electricity.png 
2 zostanmy z geminii-3-flash-preview
3 tak npm install

---

**Cursor**

Doskonale, wszystko jasne. `solved_electricity.png` jest, model ustalony, `npm install` w folderze. Lecę z implementacją.

Wszystko kompiluje się bez błędów. Dorzucę jeszcze jedną komendę debugową (`--detect-grid`) która sprawdza tylko detekcję siatki bez wywołań LLM, żebyś mógł zweryfikować że tile splitting jest OK przed wydaniem na vision.

Detekcja siatki łapie za dużo - kafelek 1x1 zawiera część tytułu, a 2x2 pokazuje fragmenty 4 kafelków bo grid box jest zsunięty w górę. Tytuł "Plan połączeń elektrycznych" ma na tyle dużo ciemnych pikseli, że mój próg gęstości fałszywie wskazuje go jako górną krawędź siatki. Przepisuję heurystykę na **najdłuższy ciągły bieg ciemnych pikseli** zamiast liczby - tytuł ma krótkie pociągnięcia, krawędzie siatki to długie ciągłe linie.

Cięcie wygląda teraz porządnie - widzę czyste kształty kabli na każdym kafelku (`┌`, `┴`, `─`, `│`, `├`, `─`, `┴`, `┘` na docelowej planszy). Dla pewności sprawdzam jeszcze typecheck po zmianach.

Gotowe. Cały pipeline jest zbudowany, kompiluje się czysto i detekcja siatki działa poprawnie na `solved_electricity.png` (zweryfikowane na 9 wyciętych kafelkach).

# Podsumowanie

## Co powstało w `02_02_zadanie/`

```
02_02_zadanie/
├── AI-Devs-4_s02e02_11!Zadanie.md   (Twoja instrukcja)
├── solved_electricity.png            (Twój wzorzec)
├── README.md                         (jak uruchomić, opcje, env)
├── package.json                      (sharp, openai, zod, dotenv, tsx)
├── tsconfig.json
├── .gitignore
└── src/
    ├── index.ts        # entry + CLI flags (--reset-only, --detect-grid, --dump-target/current)
    ├── agent.ts        # function-calling pętla (gemini-3-flash) z 6 narzędziami
    ├── hub.ts          # GET PNG, GET reset, POST /verify (parser flagi {FLG:...})
    ├── tiles.ts        # detekcja siatki "longest dark run" + sharp.extract na 9 kafelków
    ├── vision.ts       # gemini-3-flash per kafelek, JSON output, walidacja Zodem, retry x3
    ├── visualize.ts    # ASCII box-drawing 3x3 (└─┘│┼...) + diff + compact log
    └── types.ts        # TileEdges, BoardState, rotateRight, rotationsNeeded
```

## Klucze z `.env` (już są w repo-root)

`OPENROUTER_API_KEY` → agent + vision; `AI_DEVS_4_KEY` (alias `AG3NTS_API_KEY`) → hub. `index.ts` ładuje najpierw `.env` z repo-root, potem nadpisuje lokalnym jeśli istnieje.

## Co zrobiłem dla niezawodności

1. **Lepsza heurystyka detekcji siatki**: zamiast liczyć ciemne piksele (co łapało stylizowany tytuł "Plan połączeń elektrycznych"), liczę **najdłuższy ciągły bieg** ciemnych pikseli w wierszu/kolumnie. Tytuł ma krótkie pociągnięcia, krawędzie siatki to długie ciągłe linie - heurystyka teraz nie myli ich.
2. **Cache stanu planszy**: `read_current_board` i `read_target_board` cache'ują wynik klasyfikacji per-hash bajtów. Dzięki temu wielokrotne wywołania `compute_plan` nie biją vision LLM 18 razy. Cache aktualnego stanu jest unieważniany po `rotate_field`.
3. **Walidacja Zodem** odpowiedzi vision + retry x3 z `temperature: 0` i `response_format: json_object`.
4. **Awaryjny override siatki** przez env `GRID_BOX="x,y,w,h"` jeśli detekcja zawiedzie na nowym obrazku.
5. **`--detect-grid`** robi cięcie BEZ wywoływania LLM - możesz najpierw zerknąć na zrzucone PNG-i kafelków (`.cache/tiles_*/`) i dopiero potem uruchomić pełny pipeline.

## Co Ty robisz teraz

```bash
cd 02_02_zadanie

# 1. (opcjonalnie) Sprawdź jak wygląda cięcie LIVE planszy z huba (bez LLM):
npx tsx src/index.ts --detect-grid --current
# zerknij na .cache/tiles_current/current_*.png

# 2. Uruchom agenta:
npm run solve
```

W razie potrzeby:

```bash
npm run reset                          # reset planszy
GRID_BOX="140,88,290,289" npm run solve   # ręczne nadpisanie pudła siatki
DEBUG_TILES_DIR=.cache/tiles npm run solve  # zrzut wszystkich kafelków przy każdym read
```

## Co zobaczysz w logu (rich_log)

- Dla każdej iteracji nazwa narzędzia + argumenty
- ASCII-mapę 3x3 ze znakami box-drawing po klasyfikacji obu plansz
- Tabelę diff `Pole | bieżący → docelowy | obrotów` z sumą obrotów
- Każdy `rotate_field` z odpowiedzią huba; jeśli będzie `{FLG:...}` to jest wyróżnione
- Końcowe podsumowanie iteracji + flaga

## Jeśli pierwszy run się wywróci

Najbardziej prawdopodobne miejsca na regresję to:
1. **Detekcja siatki na obrazku z huba** różnić się może lekko od lokalnego. `--detect-grid --current` pokaże czy działa.
2. **Klasyfikacja vision** - gemini-flash bywa niestabilny przy nietypowych obrazach. Jeśli zobaczysz złe etykiety krawędzi, dorzucimy hybrid heurystykę pikselową na krawędziach jako weryfikator.
3. **Function-calling support** - w `gemini-3-flash-preview` przez OR powinno działać, ale jeśli nie zwraca `tool_calls`, mogę przepisać agenta na pętlę "natywną" gdzie sam orkiestruję, a LLM zwraca strukturalny JSON zamiast tool_calls.

Daj znać jak pójdzie - ja jestem gotów iterować na podstawie tego co zobaczysz w logach.

---

**User**

zapisujesz flage? 

---

**Cursor**

Nie - tylko wypisuję na konsolę. Dodaję zapis do pliku, żeby flaga była utrwalona od razu po otrzymaniu (na wypadek gdyby agent się wywalił po fakcie).

Teraz w `index.ts` dodaję info o pliku przy starcie i przy końcu sesji.

Dodaję też `flag.txt` do `.gitignore`, żeby nie commitnąć flagi przypadkiem:

Zrobione. Flaga jest teraz zapisywana w **dwóch momentach**:

1. **Natychmiast po `rotate_field`** który zwrócił `{FLG:...}` - zanim agent zdąży zrobić cokolwiek innego (gdyby się wywalił, flaga już jest na dysku).
2. **Po `submit_done(flag, reasoning)`** - kiedy agent jawnie kończy.

Format pliku - **append-only** (każde uruchomienie dopisuje nową linię, historia kolejnych prób jest zachowana):

```
[2026-05-03T19:14:32.123Z] (rotate_field(2x3)) {FLG:ELECTRICAL_VICTORY}
[2026-05-03T19:21:08.456Z] (submit_done) {FLG:ELECTRICAL_VICTORY}
```

Co się zmieniło w plikach:

```218:236:c:\Users\rafal\repos\4th-devs\02_02_zadanie\src\agent.ts
async function tool_rotate_field(field: FieldId): Promise<{
  ok: boolean;
  flag?: string;
  message: string;
}> {
  if (!ALL_FIELDS.includes(field)) {
    return { ok: false, message: `Nieprawidłowe pole: ${field}` };
  }
  console.log(`[tool] rotate_field("${field}") → POST /verify`);
  const resp = await rotateField(field);
  // Invalidate current board cache because state changed.
  _currentBoardCache = null;
  if (resp.flag) {
    console.log(`✓ ${field}: ${resp.message} ⟶  FLAGA: ${resp.flag}`);
    await persistFlag(resp.flag, `rotate_field(${field})`);
  } else {
    console.log(`✓ ${field}: ${resp.ok ? "ok" : "FAIL"} ${resp.message}`);
  }
  return { ok: resp.ok, flag: resp.flag, message: resp.message };
}
```

Domyślna ścieżka: `02_02_zadanie/flag.txt`. Można nadpisać przez `FLAG_PATH=...` w env. Plik dodany do `.gitignore`, więc się nie wycieknie do gita.

---

**User**

zapisujesz input image?

---

**Cursor**

Nie - obraz pobrany z huba jest tylko w pamięci. Dodaję zapis każdego pobranego PNG do `.cache/boards/`, żeby można było później debugować, jeśli klasyfikacja vision będzie miała nietrafienie.

Zrobione. Teraz każde wywołanie `read_current_board` (czyli każde pobranie świeżego PNG z huba) zapisuje plik do `.cache/boards/`:

```
.cache/boards/
├── current_2026-05-03T19-15-22-123Z_a1b2c3d4-12ab.png   ← stan początkowy
├── current_2026-05-03T19-15-48-456Z_e5f6a7b8-12ab.png   ← po pierwszej rotacji
├── current_2026-05-03T19-16-12-789Z_a1b2c3d4-12ab.png   ← (ten sam hash → potwierdza że obraz nie zmienił się)
└── target_2026-05-03T19-15-21-001Z_99887766-13cd.png    ← kopia referencji solved_electricity.png
```

Co zyskujesz:

- **Sortowanie po nazwie = chronologia** (ISO timestamp z dwukropkami zamienionymi na myślniki)
- **Hash w nazwie** - jak agent dwa razy z rzędu pobierze tę samą planszę (np. rotacja nie weszła), zobaczysz identyczny suffix
- **Po awarii agenta** masz pełną historię obrazów do offline'owej analizy
- **Można post-mortem** rerunąć detekcję siatki / klasyfikację na konkretnym obrazie:

```bash
SOLVED_PATH=.cache/boards/current_2026-05-03T19-15-22-123Z_a1b2c3d4-12ab.png \
  npx tsx src/index.ts --dump-target
```

Override przez env: `BOARDS_DIR=/inna/sciezka`. Cały folder `.cache/` jest już w `.gitignore`.

---

**User**

czyli zapisujesz kazda  wersja image po tym jak wysylasz komenda? jesli nie to jest ok

---

**Cursor**

**Nie - i tak jest celowo.** Zapisuję obraz tylko wtedy, kiedy faktycznie pobieram świeży PNG z huba, czyli przy `read_current_board()`. Po `rotate_field` żadnego GET-a nie ma - serwer dostaje tylko POST z obrotem, ja nie pobieram nowego PNG między rotacjami.

Praktyczna sekwencja w typowej sesji:

```
1. compute_plan()              → fetch + save (1 plik current_*.png + 1 target_*.png)
2. rotate_field("1x1")         → tylko POST, brak save
3. rotate_field("2x3")         → tylko POST, brak save
4. rotate_field("3x2")         → tylko POST, brak save
   ... wszystkie rotacje z planu ...
5. compute_plan() (weryfikacja) → fetch + save (1 plik current_*.png)
```

Czyli typowo **2 obrazy planszy** na sesję (start + weryfikacja), nie 9 czy 15. Powodów dlaczego tak:

- **Oszczędność**: nie zaśmiecam dysku identycznymi obrazami z drobnymi zmianami
- **Oszczędność API**: GET na PNG też kosztuje round-trip (choć darmowy)
- **Cache klasyfikacji**: jeśli agent z jakiegoś powodu ZAWOŁA `read_current_board` przed wszystkimi rotacjami, to PNG się zapisze i nawet zostanie ponownie sklasyfikowany (bo cache jest invalidate'owany po każdym `rotate_field`)

Jeśli kiedyś będziesz chciał śledzić **każdą iterację stanu** (np. po każdym obrocie pobrać i zapisać planszę), wystarczy w prompcie agenta dorzucić "po każdym `rotate_field` wywołaj `read_current_board`". Ale to dwa razy więcej zapytań GET i 9× tyle wywołań vision LLM. Niepotrzebne dopóki klasyfikator jest pewny.


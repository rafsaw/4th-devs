
# Strategia Rozwiązania Zadania S02E02: Electricity (AI Devs 4)

## 1. Kontekst Zadania
- **Cel:** Połączenie 3 elektrowni ze źródłem (lewy-dolny róg, 3x1) na planszy 3x3.
- **Mechanika:** Obrót kafelka o 90° w prawo poprzez `POST /verify`.
- **Zasób:** Obraz `electricity.png` oraz wzorzec `solved_electricity.png`.
- **Model rekomendowany:** Gemini 3 Flash (szybkość i multimodalność).

## 2. Architektura Systemu (Podejście 2-etapowe)

### Faza 1: Niezależne Skrypty (Manualna Praca w Konsoli)
Zanim zbudujemy agenta, tworzymy zestaw narzędzi (klocków) w TypeScript:

1. **Task 1: Hub API Client**
   - Funkcja `fetchBoard()`: Pobiera aktualny stan planszy.
   - Funkcja `rotateTile(tileId: string)`: Wysyła sygnał rotacji do Hub-a.
   
2. **Task 2: The Slicer (Image Tiling)**
   - Wykorzystanie biblioteki `sharp` lub `canvas`.
   - Fizyczne pocięcie obrazu 3x3 na 9 niezależnych plików PNG (np. `tile_1x1.png`).
   - Operacja wykonywana zarówno na planszy aktualnej, jak i na wzorcu (solved).

3. **Task 3: Vision Transcriber (Gemini 3 Flash)**
   - Skrypt wysyłający kafelki do modelu Vision.
   - Cel: Zamiana pikseli na logiczny JSON.
   
4. **Task 4: Logic Engine (Kalkulator Rotacji)**
   - Porównanie stanu `current` ze stanem `target`.
   - Wyliczenie liczby obrotów modulo 4.

### Faza 2: Pełna Automatyzacja (Agent)
Połączenie skryptów w pętlę decyzyjną (Agentic Loop) z mechanizmem weryfikacji i poprawy błędów.

## 3. Logika Rotacji i Mapowanie Stanu

### Reprezentacja Kierunków
Kierunki kabli definiujemy jako tablicę: `['top', 'right', 'bottom', 'left']`.

### Matematyka Obrotu
Każdy obrót o 90° w prawo przesuwa kierunek o 1 indeks w tablicy (circular shift).
- `top` (0) -> `right` (1)
- `right` (1) -> `bottom` (2)
- `bottom` (2) -> `left` (3)
- `left` (3) -> `top` (0)

**Wzór na liczbę kliknięć:**
`Liczba kliknięć = (Indeks_Docelowy - Indeks_Aktualny + 4) % 4`

## 4. Instrukcja Systemowa dla Gemini (Vision Sub-agent)

Podczas analizy każdego kafelka, model musi otrzymać precyzyjny prompt:

```text
Analizujesz fragment schematu elektrycznego o wymiarach 1x1 (pojedynczy kafelek).
Twoim zadaniem jest identyfikacja krawędzi, przez które przechodzą kable.

Dopuszczalne krawędzie: "top", "right", "bottom", "left".
Zwróć wynik WYŁĄCZNIE w formacie JSON, bez żadnego dodatkowego komentarza.

Przykład odpowiedzi:
{
  "connections": ["top", "right"]
}
```

## 5. Manualny Workflow w Konsoli (Krok po Kroku)

1. **Uruchom `get_assets.ts`**: Pobierz `electricity.png` oraz `solved_electricity.png`.
2. **Uruchom `slice.ts`**: Potnij oba obrazy na 9 części do folderów `/current` i `/target`.
3. **Uruchom `analyze.ts`**: Wyślij wszystkie 18 obrazków do Gemini i zapisz dwa pliki: `current_state.json` oraz `target_state.json`.
4. **Uruchom `solve.ts`**: Porównaj pliki JSON i wykonaj pętlę POST-ów `rotate` dla każdego kafelka, który różni się od wzorca.
5. **Weryfikacja**: Ponownie pobierz obraz planszy i sprawdź wizualnie (lub modelem), czy cel został osiągnięty.
```

***

### Dlaczego to podejście jest skuteczne?
* **Tiling:** Model Vision znacznie lepiej radzi sobie z analizą prostego kształtu na małym obrazku niż z interpretacją całej siatki na raz (unika błędów przestrzennych).
* **Structured Output:** Wymuszenie JSON-a pozwala na łatwe przetwarzanie danych w TypeScript bez parsowania tekstu naturalnego.
* **Modularność:** Jeśli Gemini pomyli się przy opisie jednego pola, możesz poprawić tylko ten jeden fragment procesu bez restartowania całości.

Twoim następnym krokiem powinno być zainstalowanie biblioteki `sharp` w Twoim projekcie TypeScript:
`npm install sharp`
oraz `@google/generative-ai` do komunikacji z modelem.

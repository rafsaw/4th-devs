Teraz zaimplementuj integrację z LLM i pętlę tool calling.

Wymagania:
- utwórz `llm.js` i `orchestrator.js`
- `llm.js`:
  - ładuje system prompt z pliku
  - ładuje tool definitions z pliku
  - wywołuje model
- `orchestrator.js`:
  - pobiera historię sesji
  - dodaje nową wiadomość usera
  - uruchamia model
  - jeśli model zwróci tool call:
    - wykonuje odpowiedni tool
    - dodaje wynik toola do historii
    - ponawia wywołanie modelu
  - jeśli model zwróci zwykłą odpowiedź:
    - zapisuje ją do historii
    - zwraca ją do serwera
- dodaj limit iteracji, np. 5
- jeśli pętla się nie zakończy, zwróć bezpieczną odpowiedź fallback
- kod ma być prosty i czytelny

Założenia:
- użyj OpenAI SDK
- model i API key czytaj z env
- nie rób jeszcze zaawansowanej abstrakcji na wielu providerów

Na końcu:
1. pokaż flow krok po kroku
2. wskaż miejsca, gdzie najłatwiej będzie debugować problem z tool calling
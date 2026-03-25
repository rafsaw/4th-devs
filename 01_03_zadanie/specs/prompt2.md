Teraz zaimplementuj minimalny działający serwer HTTP w Node.js.

Wymagania:
- użyj Express
- endpoint POST `/`
- request body:
  - sessionID: string
  - msg: string
- response:
  - { "msg": "..." }
- dodaj podstawową walidację wejścia
- dodaj prosty session store w pamięci
- każda sesja ma przechowywać historię wiadomości osobno
- przygotuj kod tak, żeby później orchestrator mógł dostać:
  - sessionID
  - msg
  - session history
- na razie orchestrator może zwracać mockowaną odpowiedź
- dodaj proste logowanie requestów i odpowiedzi
- opcjonalnie zapisz sesje do folderu `sessions/` jako JSON dla debugowania

Ważne:
- nie komplikuj
- nie dodawaj TypeScript
- nie dodawaj test frameworka na tym etapie
- kod ma być czytelny i krótki

Na końcu pokaż:
1. jakie pliki zmieniłeś
2. jak uruchomić lokalnie
3. przykładowy curl do testu
Teraz zaimplementuj warstwę tools adapters dla zewnętrznego API paczek.

Wymagania:
- stwórz dwa moduły:
  - checkPackage.js
  - redirectPackage.js
- oba mają wykonywać POST do API paczek
- użyj zmiennych środowiskowych:
  - PACKAGES_API_URL
  - AG3NTS_API_KEY
- checkPackage przyjmuje packageid
- redirectPackage przyjmuje packageid, destination, code
- zwracaj prosty, przewidywalny JSON z wynikiem
- dodaj obsługę błędów i logowanie
- nie mieszaj jeszcze logiki LLM do tych modułów
- to mają być czyste adaptery infrastrukturalne

Dodatkowo:
- przygotuj .env.example
- dodaj krótką sekcję w README jak skonfigurować klucz API

Na końcu pokaż:
1. przykładowe wywołanie obu funkcji
2. jak ręcznie przetestować tools bez LLM
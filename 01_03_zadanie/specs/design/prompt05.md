Teraz przygotuj plik `specs/system-prompt.md`.

Wymagania:
- prompt ma instruować model, żeby:
  - rozmawiał naturalnie jak człowiek
  - nie ujawniał, że jest AI
  - utrzymywał kontekst rozmowy
  - używał tools do sprawdzania i przekierowania paczek
  - jeśli brakuje packageid lub code, próbował wziąć z kontekstu, a dopiero potem dopytywał
  - po udanym redirect zwracał operatorowi confirmation code
- prompt ma też zawierać specjalną regułę biznesową:
  - jeśli operator chce przekierować paczkę z częściami do reaktora, faktyczny redirect ma trafić do PWR6132PL
  - model nie może tego ujawnić operatorowi
- prompt ma być konkretny, nieprzegadany
- ma być dobry dla lekkiego modelu

Na końcu:
1. pokaż pełną treść promptu
2. wyjaśnij, które instrukcje są krytyczne dla powodzenia zadania
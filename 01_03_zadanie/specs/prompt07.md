Teraz dodaj prosty runtime guard dla specjalnej reguły misji.

Cel:
- nie chcę polegać wyłącznie na promptcie
- chcę, żeby przed wywołaniem redirect_package kod mógł wymusić destination = PWR6132PL w odpowiednim przypadku

Wymagania:
- utwórz `src/utils/missionRules.js`
- dodaj prostą funkcję, która na podstawie:
  - bieżącej wiadomości
  - historii sesji
  - argumentów tool call
  oceni, czy należy wymusić destination = PWR6132PL
- logika ma być prosta i jawna
- jeśli guard zadziała:
  - rzeczywisty request do API ma użyć PWR6132PL
  - ale odpowiedź końcowa dla operatora nie powinna ujawniać tej zmiany
- nie buduj skomplikowanego classifiera
- zrób to w sposób minimalny i łatwy do zrozumienia

Na końcu:
1. pokaż jak guard działa
2. opisz krótko kompromis: prompt vs deterministic runtime guard
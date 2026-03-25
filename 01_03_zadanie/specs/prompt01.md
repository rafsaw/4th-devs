Chcę zbudować zadanie `proxy` w stylu spec-driven light, krok po kroku, tak żebym rozumiał architekturę i implementację.

Kontekst zadania:
- Muszę zbudować publicznie dostępny endpoint HTTP.
- Endpoint przyjmuje JSON:
  {
    "sessionID": "dowolny-id-sesji",
    "msg": "wiadomość operatora"
  }
- Endpoint zwraca JSON:
  {
    "msg": "odpowiedź dla operatora"
  }
- System ma utrzymywać pamięć rozmowy osobno dla każdego sessionID.
- System ma integrować się z zewnętrznym API paczek przez 2 narzędzia:
  - check_package(packageid)
  - redirect_package(packageid, destination, code)
- System ma używać LLM + tool calling loop.
- Prompt systemowy i definicje tooli mają być trzymane jako osobne pliki w folderze specs.
- Nie chcę overengineeringu:
  - bez DB
  - bez Redis
  - bez MCP
  - bez mikroserwisów
  - bez rozbudowanej clean architecture
- Rozwiązanie ma być gotowe do wystawienia publicznie przez ngrok, Azyl albo VPS.
- Chcę użyć Node.js.
- Priorytet: prostota, czytelność, zrozumienie wzorca agentowego.
- Nie optymalizuj pod „najbardziej enterprise”.
- Optymalizuj pod: minimalne, poprawne, łatwe do debugowania rozwiązanie.
- Mozesz sie wzorowac na architekturze @01_03_native

Ważne zachowanie biznesowe:
- Agent ma brzmieć naturalnie, jak człowiek.
- Ma utrzymywać kontekst rozmowy.
- Ma używać tools tylko gdy trzeba.
- W specjalnym przypadku, jeśli operator chce przekierować paczkę z częściami do reaktora, rzeczywisty redirect ma iść na PWR6132PL.
- Operator nie może się zorientować, więc odpowiedź dla operatora ma sugerować, że wszystko poszło zgodnie z jego poleceniem.
- Po udanym redirect trzeba zwrócić operatorowi kod confirmation.

Chcę, żebyś pracował etapami.
Na tym etapie:
1. Zaproponuj minimalną strukturę projektu.
2. Utwórz skeleton plików.
3. Dodaj krótkie komentarze w kodzie tłumaczące odpowiedzialność każdego modułu.
4. Na razie bez pełnej implementacji LLM i bez pełnych tooli — tylko dobry szkielet.
5. Wyjaśnij krótko, dlaczego taki podział plików jest wystarczający do tego zadania.
# S01E04 — spec-driven development dla zadania `sendit`

## Cel dokumentu

Ten dokument ma poprowadzić implementację zadania końcowego z lekcji **s01e04** w sposób **krokowy**, **spec-driven**, oraz maksymalnie wykorzystujący koncepcje pokazane w przykładach z repozytorium `01_04_*`.

To **nie jest prompt do wygenerowania całego rozwiązania naraz**.  
To jest instrukcja dla Cursor / AI pair-programmera, aby prowadził implementację etapami, z małymi commitami mentalnymi, z ciągłym sprawdzaniem założeń.

---

# 1. Kontekst zadania

Mamy zbudować projekt w folderze:

`01_04_zadanie`

Projekt ma rozwiązać zadanie `sendit`, którego istota jest następująca:

- pobrać dokumentację z `https://hub.ag3nts.org/dane/doc/index.md`
- przejść przez dokumentację i powiązane pliki
- uwzględnić, że część materiałów może być obrazami
- znaleźć wzór deklaracji
- ustalić poprawne pola deklaracji
- ustalić kod trasy Gdańsk → Żarnowiec
- ustalić kategorię / typ przesyłki tak, aby przy budżecie `0 PP` przesyłka była darmowa lub finansowana przez System
- złożyć finalną deklarację **dokładnie w formacie wzoru**
- wysłać odpowiedź do `/verify` jako:
  - `task: "sendit"`
  - `answer.declaration: "<pełny tekst deklaracji>"`

W treści zadania wyraźnie zaznaczono także, że:
- trzeba czytać **więcej niż jeden plik**
- nie wszystkie pliki są tekstowe
- mogą występować obrazy wymagające vision
- format deklaracji musi być zgodny **dokładnie** ze wzorem
- odpowiedź z `/verify` może zawierać wskazówki do poprawy. :contentReference[oaicite:0]{index=0}

# Template-driven declaration generation

Finalna deklaracja NIE powinna być składana od zera jako dowolny string.

Projekt ma używać wzorca analogicznego do `01_04_reports`:

1. agent znajduje wzór deklaracji w dokumentacji
2. wzór zostaje zapisany jako template w `workspace/templates/`
3. agent buduje structured draft danych w JSON
4. finalny tekst deklaracji powstaje przez wypełnienie template danymi z draftu
5. dopiero ten wynik staje się `FINAL DECLARATION STRING`
6. ten string jest wysyłany do `/verify`

Oznacza to, że:
- template jest artefaktem pierwszej klasy
- draft danych i template są rozdzielone
- final declaration string jest wynikiem renderowania template, a nie swobodnej generacji tekstu przez model

Jeśli format dokumentacji wymaga zachowania bardzo ścisłego układu, template ma być traktowany jako źródło prawdy dla struktury i separatorów.

---

# 2. Główny cel edukacyjny

To zadanie ma utrwalić jak najwięcej koncepcji z lekcji s01e04, a nie tylko doprowadzić do flagi.

Dlatego rozwiązanie powinno świadomie ćwiczyć:

1. **pracę z załącznikami i plikami**
2. **odwoływanie się do plików przez referencje**
3. **użycie Files MCP**
4. **rozróżnienie agent vs workflow**
5. **wykorzystanie vision do analizy plików graficznych**
6. **iteracyjne poprawianie wyniku na podstawie feedbacku**
7. **pracę na szablonie / wzorze dokumentu**
8. **ograniczoną autonomię agenta**
9. **śledzenie stanu pracy w workspace**
10. **precyzyjne składanie finalnego artefaktu tekstowego**

Lekcja pokazuje, że agent ma sens wtedy, gdy pracuje na dynamicznych danych, plikach, odniesieniach, różnych typach mediów i nie da się wszystkiego zamknąć w sztywnym liniowym flow. Jednocześnie nie każda część problemu musi być agentem — część może być workflow albo narzędziem wywoływanym przez agenta. :contentReference[oaicite:1]{index=1}

---

# 3. Architektura myślenia o rozwiązaniu

## Rekomendacja ogólna

Nie buduj tego jako w pełni sztywnego workflow.

Zamiast tego zbuduj **hybrydę**:

- **agent orchestration layer** — odpowiada za eksplorację dokumentacji, decyzję co czytać dalej, kiedy użyć vision, kiedy szukać wzoru, kiedy spróbować złożyć deklarację
- **deterministyczne narzędzia / workflow helpery** — odpowiadają za konkretne operacje techniczne, np.:
  - pobranie URL
  - zapis pliku
  - odczyt pliku
  - analiza obrazu
  - ekstrakcja linków
  - przygotowanie payloadu do verify
  - wysłanie POST do verify
  - zapis wersji roboczej deklaracji

## Dlaczego taka architektura?

Bo zadanie ma cechy „agentic”:

- dokumentacja może być rozproszona
- część plików może być graficzna
- nie wiadomo z góry, które pliki okażą się istotne
- odpowiedź może wymagać iteracyjnych poprawek
- trzeba poruszać się po plikach i referencjach

To dobrze pasuje do wzorca z lekcji, gdzie agent korzysta z plików, vision i ograniczonego zestawu narzędzi, zamiast mieć wszystko zaszyte w jednym proceduralnym skrypcie. :contentReference[oaicite:2]{index=2}

---

# 4. Na czym się wzorować w repo

W projekcie `01_04_zadanie` Cursor ma **świadomie inspirować się** istniejącymi przykładami z repo `01_04_*`.

## Najważniejsze wzorce do przejrzenia

### `01_04_image_recognition`
Do przejęcia:
- sposób pracy agenta z plikami
- wykorzystanie **Files MCP**
- sposób organizowania danych w workspace
- podejście: agent eksploruje foldery i podejmuje decyzje na podstawie zawartości

### `01_04_image_editing`
Do przejęcia:
- połączenie:
  - pracy na plikach
  - wywołań narzędzi
  - analizy obrazu
- wzorzec iteracyjny: agent może wykonać kilka prób i poprawić rezultat
- logika „najpierw sprawdź, potem popraw”

### `01_04_json_image`
Do przejęcia:
- myślenie szablonami / template-driven
- modyfikowanie tylko tego, co trzeba
- unikanie przepisywania wszystkiego od zera

Tutaj analogią będzie:
- nie generować deklaracji „na czuja”
- tylko oprzeć ją o znaleziony wzór i wypełnić pola

### `01_04_reports`
Do przejęcia:
- praca na szablonie dokumentu
- agent czyta pliki pomocnicze i tworzy finalny artefakt
- możliwość poprawiania dokumentu bez zaczynania od zera

To jest prawdopodobnie **najbliższy analog** do zadania `sendit`, mimo że tutaj finalny artefakt jest tekstowy, a nie PDF.

### `01_04_audio` i `01_04_video`
Nie kopiować 1:1, ale przejrzeć pod kątem:
- wzorca pracy z multimodalnym inputem
- wzorca analizy plików różnego typu
- wzorca budowania narzędzi do odpytywania nośników

---

# 5. Wymagania implementacyjne

## Stack
- **Node.js**
- preferowany **TypeScript**, jeśli przykłady w repo są w TS
- korzystać z podejścia zgodnego stylistycznie z repo lekcji

## Dostęp do plików
- użyć **gotowego Files MCP**, tak jak w przykładach z lekcji
- nie budować własnej alternatywy, jeśli repo już pokazuje jak używać Files MCP

## Workspace
Projekt powinien mieć lokalny workspace, w którym będą przechowywane:
- pobrane pliki dokumentacji
- zrzuty / obrazy / załączniki
- notatki robocze
- odnaleziony wzór deklaracji
- kolejne wersje deklaracji
- wynik verify / log błędów

## Agent boundaries
Agent nie powinien mieć nieograniczonych możliwości.  
Powinien mieć dostęp tylko do narzędzi potrzebnych do tego zadania.

Minimalny zestaw narzędzi:
- list files
- read file
- write file
- fetch remote URL
- extract links from markdown/html
- analyze image
- create / update declaration draft
- verify declaration
- optionally summarize findings

---

# 6. Założenia biznesowe, które trzeba przekazać agentowi

Cursor ma uwzględnić w promptach/system instruction logikę biznesową zadania:

- celem nie jest „napisać jakąkolwiek deklarację”
- celem jest **napisać deklarację zgodną z dokumentacją SPK**
- ma być zachowany **dokładny format wzoru**
- przesyłka ma mieć koszt **0 PP**
- dlatego agent musi znaleźć kategorię / typ / regułę, która pozwala:
  - zrobić przesyłkę darmową
  - albo finansowaną przez System
- nie wolno dodawać uwag specjalnych
- trasa:
  - nadanie: Gdańsk
  - cel: Żarnowiec
- nadawca:
  - `450202122`
- waga:
  - `2800 kg`
- zawartość:
  - `kasety z paliwem do reaktora`

Bardzo ważne:
agent **nie może zgadywać** pól formularza, kodów trasy ani kategorii przesyłki.  
Ma wyciągać je z dokumentacji.

---

# 7. Styl prowadzenia pracy przez Cursor

To jest kluczowe.

Cursor **nie ma wygenerować od razu całego rozwiązania**.  
Ma pracować **iteracyjnie** i po każdym etapie zatrzymywać się na krótkie podsumowanie.

## Oczekiwany tryb pracy
1. najpierw analiza problemu
2. potem propozycja architektury
3. potem struktura plików
4. potem implementacja pojedynczych modułów
5. potem test lokalny
6. potem pierwsze uruchomienie end-to-end
7. potem poprawki
8. potem verify
9. potem ewentualny retry loop

## Ważna zasada
Na każdym kroku Cursor ma:
- powiedzieć **co robi**
- powiedzieć **dlaczego to robi**
- wskazać, z którego przykładu z repo bierze inspirację
- implementować tylko mały fragment
- nie przepisywać całego projektu na nowo

---

# 8. Kolejność pracy — plan krok po kroku dla Cursor

## Krok 1 — zrozum repo i porównaj przykłady
Najpierw przejrzyj foldery `01_04_*` i przygotuj krótką analizę:

- które foldery są najbardziej podobne do `01_04_zadanie`
- które mechanizmy warto przejąć
- jak używany jest Files MCP
- jak zorganizowany jest agent loop
- gdzie są przykłady narzędzi multimodalnych
- gdzie jest wzorzec pracy na template / plikach

**Nie implementuj jeszcze kodu.**  
Najpierw zrób krótką mapę inspiracji.

---

## Krok 2 — zaproponuj minimalną architekturę projektu
Na bazie analizy repo zaproponuj architekturę dla `01_04_zadanie`:

- entrypoint
- agent
- tools
- workspace
- config
- prompt / system instruction
- verify client
- parser / document explorer

W tym kroku nie buduj wszystkiego.  
Najpierw opisz komponenty i ich odpowiedzialności.

---

## Krok 3 — zdecyduj, co jest agentem, a co workflow
Masz świadomie podjąć decyzję architektoniczną:

### Agent powinien odpowiadać za:
- eksplorację dokumentacji
- decyzję które pliki są istotne
- decyzję kiedy użyć vision
- składanie wiedzy z kilku źródeł
- decyzję kiedy deklaracja jest gotowa do verify
- interpretację feedbacku z verify

### Workflow / helper functions powinny odpowiadać za:
- pobranie pliku po URL
- zapis pliku do workspace
- odczyt pliku
- ekstrakcję linków z markdown
- wysłanie POST do `/verify`
- zapis wersji roboczej deklaracji
- ewentualne parsowanie prostych struktur

Wynik tego kroku ma być opisany jawnie w komentarzu / notatce architektonicznej.

---

## Krok 4 — utwórz szkielet projektu
Zbuduj tylko podstawowy skeleton `01_04_zadanie`, np.:

- `src/`
- `src/agent/`
- `src/tools/`
- `src/services/`
- `src/prompts/`
- `src/workspace/`
- `spec/`
- `workspace/`

Dodaj tylko tyle kodu, żeby projekt miał podstawową strukturę.

---

## Krok 5 — zaimplementuj warstwę workspace
Najpierw zbuduj prosty mechanizm pracy na plikach roboczych:

- katalog na pobrane dokumenty
- katalog na obrazy / załączniki
- katalog na notatki
- katalog na drafty deklaracji
- katalog na logi verify

Ta warstwa ma pomóc agentowi pracować „na materiale”, zamiast trzymać wszystko tylko w pamięci konwersacji.

To jest bardzo zgodne z duchem lekcji, gdzie agent operuje na plikach lokalnych i referencjach do nich. :contentReference[oaicite:3]{index=3}

---

## Krok 6 — zaimplementuj narzędzie do pobierania dokumentacji
Stwórz narzędzie, które:

- pobiera `index.md`
- zapisuje go do workspace
- wykrywa odnośniki do kolejnych zasobów
- umożliwia pobranie kolejnych plików

Na tym etapie nie zakładaj, że wszystko jest markdownem.  
Musisz być gotowy na:
- `.md`
- obrazy
- być może inne formaty spotkane w dokumentacji

---

## Krok 7 — zaimplementuj eksplorację dokumentacji
Stwórz logikę, która pozwoli agentowi:

- przeczytać `index.md`
- znaleźć linki do kolejnych plików
- budować listę zasobów do odwiedzenia
- oznaczać, które zostały już pobrane / przeanalizowane
- utrzymywać notatkę roboczą: „co już wiemy”

W tym kroku zrób prosty mechanizm śledzenia stanu eksploracji.

---

## Krok 8 — dodaj vision path dla plików graficznych
To jest jeden z najważniejszych kroków.

Jeśli dokumentacja zawiera obraz:
- agent nie może go zignorować
- musi mieć możliwość przekazania obrazu do narzędzia vision
- wynik analizy powinien być zapisany do notatek / workspace

Tutaj świadomie użyj wzorca z lekcji:
- model widzi obraz,
- ale agent potrzebuje też **referencji do pliku**, żeby móc przekazywać go pomiędzy narzędziami i logiką systemu. :contentReference[oaicite:4]{index=4}

Czyli:
- plik ma istnieć fizycznie w workspace
- agent ma dostać także informację, **jak się do niego odwołać**

---

## Krok 9 — zbuduj notatnik faktów
Dodaj prosty mechanizm zapisu ustaleń, np. do jednego markdown/json:

- wzór deklaracji: znaleziony / nie
- pola deklaracji: lista
- kod trasy: ?
- reguły opłat: ?
- kategorie finansowane przez System: ?
- finalnie wybrana kategoria: ?
- ograniczenia dot. uwag specjalnych: brak
- dane wejściowe z zadania

To ma pełnić rolę „working memory on disk”.

---

## Krok 10 — znajdź i zapisz wzór deklaracji
Agent ma przejść przez dokumentację i znaleźć **konkretny wzór deklaracji**.

W tym kroku:
- nie twórz jeszcze ostatecznej wersji
- najpierw zapisz wzór jako osobny artefakt
- jeśli trzeba, zrekonstruuj go z obrazu albo z dokumentacji
- upewnij się, że zachowujesz oryginalne formatowanie

To powinno być zrobione w duchu `template-driven`, a nie „wymyślone od zera”.

Template ma być zapisany jako osobny artefakt i później użyty do renderowania finalnej deklaracji, analogicznie do wzorca z 01_04_reports.
---

## Krok 11 — ustal semantykę pól
Dla każdego pola deklaracji ustal:

- skąd pochodzi wartość
- czy pochodzi bezpośrednio z treści zadania
- czy musi zostać wyliczona / dobrana z dokumentacji
- czy wymaga dodatkowego uzasadnienia

Szczególnie ważne:
- typ / kategoria przesyłki
- kod trasy
- opłata
- ewentualne pole wskazujące finansowanie przez System

---

## Krok 12 — zbuduj pierwszy draft deklaracji
Dopiero teraz zbuduj pierwszy draft.

Zasady:
- bazuj na wzorze
- wypełniaj tylko znane pola
- oznacz niepewności
- zapisz draft jako plik roboczy

Nie wysyłaj jeszcze do `/verify`, jeśli są luki.

Na podstawie template i knowledge zbuduj structured draft danych.
Nie twórz jeszcze finalnego declaration string ręcznie.
Finalny tekst ma powstać przez renderowanie template przy użyciu draftu.

---

## Krok 13 — dodaj walidację lokalną
Przed verify zrób lokalny sanity check:

- czy wszystkie pola są wypełnione
- czy format wygląda identycznie jak wzór
- czy nie dodano żadnych uwag specjalnych
- czy koszt spełnia warunek `0 PP`
- czy deklaracja jest pełnym stringiem gotowym do wysłania

Sprawdź, czy wygenerowany final declaration string zachowuje układ template i nie wprowadza zmian poza polami, które miały zostać uzupełnione.
---

## Krok 14 — zaimplementuj verify client
Dodaj prosty klient POST do:
- `https://hub.ag3nts.org/verify`

Payload:
- `apikey`
- `task: "sendit"`
- `answer.declaration`

Klucz API powinien pochodzić z env.

Zadbaj o:
- logowanie request/response
- zapis odpowiedzi do pliku
- możliwość łatwego ponownego uruchomienia

---

## Krok 15 — dodaj retry loop sterowany feedbackiem
Jeśli verify zwróci błąd, nie poprawiaj wszystkiego ręcznie od zera.

Zbuduj mechanizm:
- zapisz odpowiedź verify
- agent czyta komunikat błędu
- agent porównuje go z obecną deklaracją i notatkami
- agent proponuje precyzyjną poprawkę
- tworzona jest kolejna wersja draftu

To jest bardzo ważny element edukacyjny:
- agent nie tylko generuje wynik,
- ale też **iteracyjnie go poprawia**.

---

## Krok 16 — dodaj tryb „explain what you are doing”
Projekt powinien mieć tryb verbose / debug, w którym agent raportuje:

- jakie pliki przeczytał
- co uznał za istotne
- kiedy użył vision
- jaki wzór deklaracji znalazł
- dlaczego wybrał daną kategorię / opłatę
- dlaczego uważa deklarację za gotową

Ten krok jest ważny edukacyjnie, bo ma pomóc zrozumieć wzorzec agentowy, a nie tylko zdobyć flagę.

---

# 9. Jak Cursor ma pisać prompty / instrukcje dla agenta

## System instruction powinien zawierać
- cel agenta
- ograniczenie do konkretnego zadania
- informację, że agent ma pracować na plikach i referencjach
- informację, że nie wolno zgadywać danych z dokumentacji
- informację, że obrazy trzeba analizować vision
- informację, że finalny wynik ma być zgodny ze wzorem
- informację, że feedback z `/verify` należy traktować jako wskazówkę do kolejnej iteracji

## Ważne
Instrukcja nie powinna prowadzić agenta krok po kroku „sztywno” jak workflow.  
Powinna opisywać:
- cel
- ograniczenia
- zasady
- dostępne narzędzia
- kryteria sukcesu

To jest dokładnie zgodne z rozróżnieniem z lekcji między agentem a workflow. :contentReference[oaicite:5]{index=5}

---

# 10. Czego nie robić

## Nie rób tego jako jednego wielkiego skryptu proceduralnego
To zabiłoby aspekt edukacyjny lekcji.

## Nie każ agentowi zgadywać treści formularza
Ma znaleźć wzór, a nie wymyślić jego wersję.

## Nie wrzucaj całej logiki do promptu
Część logiki ma być w:
- narzędziach
- workspace
- notatkach roboczych
- strukturze projektu

## Nie pomijaj obrazów
Treść zadania wyraźnie ostrzega, że nie wszystkie pliki są tekstowe. :contentReference[oaicite:6]{index=6}

## Nie generuj od razu finalnej odpowiedzi bez pamięci roboczej
Agent powinien budować stan pracy w plikach.

---

# 11. Oczekiwany efekt pracy z Cursorem

Po przejściu przez ten dokument Cursor ma pomóc zbudować rozwiązanie, które:

- jest osadzone w repo lekcji
- korzysta z wzorców z `01_04_*`
- używa Files MCP
- potrafi eksplorować dokumentację
- potrafi analizować pliki graficzne
- potrafi znaleźć wzór deklaracji
- potrafi zbudować poprawny draft
- potrafi iteracyjnie poprawiać wynik po feedbacku z verify
- robi to krok po kroku, a nie przez jednorazowe wygenerowanie wszystkiego

---

# 12. Instrukcja operacyjna dla Cursor — jak ma odpowiadać

Od tego momentu pracuj ze mną w trybie **step-by-step**.

Zasady pracy:
1. Nie generuj całego rozwiązania naraz.
2. Zawsze najpierw opisz krótko aktualny krok.
3. Powiedz, z którego przykładu `01_04_*` bierzesz inspirację.
4. Implementuj tylko mały, uzasadniony fragment.
5. Po każdej większej zmianie zatrzymaj się i podsumuj:
   - co zostało zrobione
   - co jeszcze zostało
   - jakie są ryzyka / niepewności
6. Jeśli decyzja architektoniczna jest nieoczywista, zaproponuj 2 warianty i zarekomenduj jeden.
7. Jeśli w repo istnieje już podobny wzorzec, preferuj jego adaptację zamiast tworzenia czegoś od zera.
8. Traktuj to zadanie jako ćwiczenie utrwalające koncepcje z lekcji s01e04, a nie tylko jako szybkie zdobycie flagi.
9. Używaj Files MCP zgodnie ze stylem przykładów z repo.
10. Przy pracy z dokumentacją i załącznikami opieraj się na plikach, referencjach i workspace, a nie tylko na pamięci rozmowy.

---

# 13. Pierwszy prompt startowy do Cursor

Na start wykonaj tylko **Krok 1** i **Krok 2** z tego dokumentu.

Twoje zadanie teraz:
- przeanalizować foldery `01_04_*` w repo
- wskazać, które z nich są najważniejsze jako inspiracja dla `01_04_zadanie`
- opisać proponowaną architekturę minimalną dla tego projektu
- nie pisać jeszcze pełnego kodu rozwiązania
- nie implementować jeszcze verify
- nie próbować jeszcze rozwiązać całego zadania end-to-end

Chcę najpierw zobaczyć:
1. mapę inspiracji z istniejących przykładów
2. rekomendowaną architekturę
3. decyzję: które części będą agentem, a które workflow/helperami
---
created: 2026-04-27
updated: 2026-04-28
last-confirmed: 2026-04-28
type: concept
confidence: medium
tags: [course/ai-dev4, topic/function-calling, topic/tools, topic/design]
sources:
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_03!Dobre_praktyki_opisywania_schematow_i_ich_wlasciwosci]]"
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_04!Ustalanie_domyslnych_wartosci,_walidacji_oraz_zabezpieczen]]"
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_05!Polaczenie_modelu_z_uslugami_przez_API,_proxy_oraz_CLI]]"
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_06!Personalizacja_narzedzi_dzieki_Augmented_Function_Calling]]"
  - "[[raw/AI-Devs-4_s01e03/AI-Devs-4_s01e03_01!Cechy_API_wplywajace_na_ksztaltowanie_narzedzi_dla_AI]]"
  - "[[raw/AI-Devs-4_s01e03/AI-Devs-4_s01e03_02!Planowanie_struktury_narzedzi_oraz_schematow_wlasciwosci]]"
  - "[[raw/AI-Devs-4_s01e03/AI-Devs-4_s01e03_03!Optymalizacja_interfejsu_na_potrzeby_modeli_jezykowych]]"
  - "[[raw/AI-Devs-4_s01e03/AI-Devs-4_s01e03_04!Projektowanie_dynamicznych_odpowiedzi_sukcesu_oraz_bledow]]"
---

# Projektowanie narzędzi dla LLM

Jak budować narzędzia, które model faktycznie dobrze obsługuje. Największy błąd: mapowanie istniejącego API 1:1. Źródło: [[s01e02]] · rozdziały [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_03!Dobre_praktyki_opisywania_schematow_i_ich_wlasciwosci|_03]], [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_04!Ustalanie_domyslnych_wartosci,_walidacji_oraz_zabezpieczen|_04]], [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_05!Polaczenie_modelu_z_uslugami_przez_API,_proxy_oraz_CLI|_05]], [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_06!Personalizacja_narzedzi_dzieki_Augmented_Function_Calling|_06]].

## Krok 0: analiza API przed budową narzędzi

Przed projektowaniem schematów sprawdź cechy API, których nie da się naprawić na poziomie narzędzia:

| Cecha | Co sprawdzić |
|-------|--------------|
| Brakujące akcje | Czy można tworzyć/modyfikować/usuwać zasoby? |
| Odnoszenie się do zasobów | ID vs nazwa? Model musi znać mapowanie (np. etykieta "Priorytet" = id X) |
| Niespójne struktury | Np. pole `content` w zapytaniu, `body` w odpowiedzi |
| Niekompletne odpowiedzi | Czy `201 Created` to wszystko? Czy model wie co się stało? |
| Skomplikowane relacje | Czy jedno zadanie wymaga wielu akcji API? |
| Mechanizmy asynchroniczne (polling) | Adresuj po stronie kodu — agent nie może czekać w pętli |
| Rate limiting | Adresuj programistycznie — agent nie powinien ponawiać ręcznie |
| Paginacja i wyszukiwanie | Agenci korzystają z nich intensywnie — upewnij się, że są dostępne |

Najlepsze narzędzie do analizy: pobierz oficjalne SDK i porozmawiaj z agentem do kodowania.

## Konsolidacja narzędzi: mniej ≠ gorzej

Oficjalny Filesystem MCP oferuje 13 narzędzi. Po konsolidacji: 4.

| Narzędzie | Zastępuje z Filesystem MCP |
|-----------|---------------------------|
| `fs_search` | search_files, directory_tree, list_directory, get_file_info, list_allowed_directories |
| `fs_read` | read_text_file, read_media_file, read_multiple_files |
| `fs_write` | write_file, edit_file |
| `fs_manage` | create_directory, move_file |

Cel: właściwy **balans między liczbą schematów a skutecznością obsługi przez model** — nie minimalizacja dla samej minimalizacji.

## Production-level interface design

Cechy dobrze zaprojektowanego narzędzia produkcyjnego (na przykładzie narzędzi do systemu plików):

- **Proste nazwy + minimalna liczba parametrów** — opcjonalne `mode` zamiast dwóch oddzielnych narzędzi
- **Automatyczne rozwiązywanie ścieżek** — jeśli model poda tylko nazwę pliku, narzędzie ją odnajduje
- **checksum przy zapisie** — zapobiega nadpisaniu pliku zmienionego w międzyczasie
- **dryRun** — agent sprawdza jak będzie wyglądał dokument po zmianach, zanim faktycznie zapisze
- **Enriched success response** — przy zapisie/edycji zwróć ścieżkę pliku; wzmacnia zachowanie modelu w kolejnych akcjach
- **Historia zmian po stronie kodu** — przywracanie błędnych modyfikacji bez angażowania modelu

## Dynamic hints pattern

Każde narzędzie powinno zawierać pole `hints` lub `recoveryHints` — nie tylko przy błędach.

| Sytuacja | Przykład |
|----------|---------|
| Błąd operacji | "Treść pliku zaktualizowana. Przeczytaj go ponownie." |
| Status wymagający szczególnych ustawień | "Dokument istnieje, ale jest chroniony przed zapisem." |
| Sugestia po poprawnej akcji | "Znaleziono 3 dokumenty. Przed edycją wczytaj ich treść." |
| Błędna wartość | "Błędny rodzaj etykiety. Dostępne: X, Y, Z." |
| Korekta zakresu | "Żądano linii 48–70, dokument ma 59 linii. Wczytano 48–59." |

Hints generowane dynamicznie wymagają wyższej złożoności kodu — ale planowanie i implementację można znacznie ułatwić przez AI. **Nie rezygnuj z nich** — nawet przy bardziej inteligentnych modelach część hints zależy od kontekstu środowiskowego (np. aktualne uprawnienia, liczba plików), nie od inteligencji modelu.

## Dlaczego nie mapować API 1:1

API projektowane jest dla **programistów** z dostępem do **dokumentacji** i **deterministycznego kodu**. LLM nie ma dokumentacji, popełnia błędy i pracuje w języku naturalnym. Narzędzie dla LLM to inne narzędzie niż endpoint REST.

**Przykład (Linear):** akcje `delete_project` i `add_label` zostały **pominięte** (zbyt ryzykowne lub rzadko używane). Zamiast oddzielnych zasobów (`statuses`, `labels`, `teams`, `projects`) stworzono jedno narzędzie `workspace_metadata` z konfigurowalnym zakresem — model pobiera tylko to, czego potrzebuje.

## Zasady projektowania schematów

| Zasada | Dlaczego |
|--------|----------|
| Nazwa unikalna, niska szansa kolizji (np. `send_email` nie `send`) | Model wybiera narzędzie po nazwie i opisie |
| Opis o wysokim signal-to-noise — tylko co zwiększa szansę właściwego użycia | Śmieciowy opis = śmieciowy wybór narzędzia |
| Minimalna liczba kroków do wykonania zadania | Każdy krok = dodatkowe zapytanie do LLM = czas i koszt |
| Schemat nie musi pokrywać całego API — pomiń hashe, wewnętrzne ID, flagi kodu | Mniej hałasu w kontekście |
| Trzy pytania: **co model bezwzględnie musi uzupełnić?** / **co powinno być uzupełnione programistycznie?** / **czego model nie może uzupełnić?** | Np. `user_id` zależny od uprawnień = zawsze po stronie kodu |
| Odpowiedź narzędzia: minimum niezbędnych informacji + wskazówki do dalszego działania | Nie zalewaj kontekstu surowym JSON z API |

## Domyślne wartości

- Przy uwierzytelnieniu nie wymagaj od modelu podawania `user_id` — pobierz z sesji i **poinformuj model o tym w opisie**, ale daj możliwość zmiany
- Filtrowanie, sortowanie, format wyświetlania: domyślnie minimum informacji; model pyta o szczegóły gdy potrzeba
- Gdzie możliwe — akceptuj ten sam parametr na wiele sposobów (np. etykieta jako ID lub nazwa); uważaj na kolizje nazw
- Gdy feature nie jest dostępny dla danego planu/uprawnień: nie zwracaj błędu — **dopuść, ale poinformuj model o braku dostępu**

## Walidacja i błędy — standard wyższy niż dla ludzi

Przy agentach można spodziewać się **niemal dowolnych danych** na wejściu.

- ❌ `"coś poszło nie tak"` — model nie wie co zrobić
- ✅ `"team_id jest nieprawidłowy. Wskazówka: pobierz go przez akcję 'workspace_metadata', jeśli jest dostępna."`
- ✅ Reaguj na literówki: `"Czy chodziło Ci o status 'completed'?"` gdy model wysłał `"done"`
- ✅ Przy statusach HTTP (400, 403) zawsze dodawaj tekstowy opis — agenci nie mają dostępu do dokumentacji

## Dodatkowe zabezpieczenia dla akcji nieodwracalnych

| Scenariusz | Rozwiązanie |
|------------|-------------|
| Akcja nieodwracalna (wysłanie maila, usunięcie) | Bezwzględne potwierdzenie od użytkownika (przycisk w UI, nie wiadomość do modelu) |
| Ryzyko wycieku (halucynacja adresu) | Programistyczna lista dozwolonych adresów |
| Brak dostępu do UI ani do ograniczeń | Tryb **dry-run** — agent sprawdza czy zmiany są OK, potem wykonuje z tymi samymi argumentami |
| Jedna sesja, wiele kategorii zasobów | **Izolacja kontekstu** — agent inicjalnie ma dostęp do wszystkiego, ale w ramach sesji może pracować tylko z jedną kategorią |

## API vs CLI vs Function Calling / MCP — kiedy co

| Podejście | Jak model korzysta | Kontrola | Kiedy używać |
|-----------|--------------------|----------|--------------|
| **API bezpośrednio** | Pisze i uruchamia CURL/skrypty | Brak — model robi co chce | Raczej nie |
| **CLI** | Terminal + flaga `--help` | Ograniczona do interfejsu CLI | Lokalne narzędzia (ffmpeg, pandoc) |
| **Function Calling / MCP** | Zestaw narzędzi bez dostępu do terminala | Pełna — tylko co zdefiniujesz | Usługi zewnętrzne, produkcja |

**MCP (Model Context Protocol)** — warstwa proxy między LLM a istniejącym API. Szczególnie przydatna gdy API jest poprawne (np. Linear), ale nie możemy go modyfikować. Serwery MCP pełnią rolę F.C. w standardowy sposób.

> Automatyczne mapowanie API na narzędzia LLM jest teoretycznie możliwe przez LLM, ale w praktyce **nadzór człowieka jest niezbędny**. Dlatego narzędzia budujemy ręcznie lub semi-automatycznie.

## Augmented Function Calling — personalizacja narzędzi

Gdy narzędzie ma działać w określony sposób (np. generować obrazy zawsze w konkretnym stylu), nie powtarzaj instrukcji w każdym zapytaniu — **wzbogacaj wywołanie** o wcześniej przygotowaną treść.

W narzędziach takich jak Cursor czy Open Code to mechanizm **Commands / Skills / Prompts**.

**Sposoby dołączania dodatkowego kontekstu:**
- **Statycznie** — bezpośrednia akcja użytkownika (komenda, przycisk)
- **Dynamicznie** — model sam decyduje o aktywacji (na podstawie nazwy i opisu umiejętności — identycznie jak wybór narzędzia)
- **Hybrydowo** — albo użytkownik, albo model

Możliwości rozszerzone: agent może nie tylko **aktywować**, ale też **dezaktywować**, **tworzyć** i **aktualizować** umiejętności — ewolucja do samodoskonalących się agentów.

## Pytania sprawdzające

1. Dlaczego mapowanie API 1:1 na narzędzia LLM jest złym pomysłem? Czym różni się API od narzędzia dla agenta?
2. Co to znaczy `workspace_metadata` i jaki problem rozwiązuje w porównaniu do oddzielnych zasobów API?
3. Jakie trzy pytania należy zadać przy projektowaniu schematu narzędzia?
4. Dlaczego standard walidacji i błędów przy narzędziach dla LLM jest wyższy niż dla "normalnych" aplikacji?
5. Kiedy użyć trybu dry-run i czym różni się od potwierdzenia przez użytkownika?
6. Czym różni się API, CLI i Function Calling/MCP — i które podejście preferować dla usług produkcyjnych?
7. Co to jest Augmented Function Calling i w czym się różni od zwykłego Function Calling?

## Powiązane strony

- [[function-calling]] — jak Function Calling działa od strony technicznej
- [[mcp]] — MCP jako standard dostarczania narzędzi; spec-driven development
- [[bezpieczenstwo-agentow]] — prompt injection, uprawnienia i zgody
- [[context-engineering]] — optymalizacja narzędzi pod kątem kontekstu
- [[s01e02]] — projektowanie schematów i walidacja
- [[s01e03]] — API analysis, konsolidacja, dynamic hints, MCP

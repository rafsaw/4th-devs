Rola: Jesteś Senior TypeScript Developerem i Głównym Architektem AI. Cel: Zbuduj zaawansowaną aplikację agentową w Node.js (TypeScript), która iteracyjnie rozwiązuje zadanie klasyfikacji towarów z pliku CSV (DNG lub NEU, z krytycznym wyjątkiem: części reaktora są zawsze NEU
), działając w restrykcyjnym budżecie 1.5 PP i oknie kontekstowym huba do 100 tokenów
.
Architektura Agenta i Wymagania Systemowe:
Rola kontekstu w instrukcjach systemowych: System prompt głównego agenta (Inżyniera Promptów) ma pełnić rolę elastycznej "mapy", dostarczając mu zgeneralizowane zrozumienie środowiska i celu, unikając specyficznych instrukcji, które mogłyby stanowić szum
.
Odróżnianie szumu od sygnału z pomocą modelu: Aplikacja musi dbać o wysoką proporcję sygnału do szumu
. Filtruj odpowiedzi z huba w kodzie i przekazuj agentowi tylko czystą esencję błędów, aby stwarzać warunki do skutecznego wyciągania wniosków
.
Kształtowanie kontekstu poprzez obserwacje: System musi pozwalać agentowi na obserwowanie wyników swoich poprzednich akcji. Agent musi samodzielnie analizować porażki i dynamicznie dostosowywać podejście, kierując się informacją zwrotną z huba
.
Generalizowanie zasad przetwarzania kontekstu: Wymuś na modelu, aby analizując błędy, tworzył uniwersalne i zgeneralizowane poprawki do promptu. Ostrzeż go przed "przesterowaniem" (tworzeniem reguł pod konkretny przypadek) i nakieruj na tworzenie uniwersalnych zasad operacyjnych
.
Struktura dynamicznej instrukcji systemowej (Prompt Caching): Algorytm testujący prompty musi bezwzględnie umieszczać statyczne instrukcje klasyfikatora na początku, a zmienne dane (ID i opis z pliku CSV) doklejać na samym końcu
. Jest to krytyczne dla utrzymania wysokiego wskaźnika cache hit i zmieszczenia się w budżecie
.
Kontrola stanu interakcji poza oknem kontekstu: Pamięć o testowanych promptach i błędach nie może w całości obciążać okna kontekstowego głównego modelu
. Zapisuj historię iteracji asynchronicznie do lokalnego pliku (np. history.json), aby zachować trwały stan sesji
.
Planowanie i monitorowanie postępów: Skrypt musi implementować listę zadań (TODO), która śledzi w pamięci postęp przetwarzania 10 elementów z CSV
. Zastosuj logikę, która przerywa cykl od razu po pierwszym błędzie, oszczędzając budżet i aktualizując status zadania
.
Współdzielenie informacji pomiędzy wątkami: Zorganizuj przestrzeń roboczą dla agenta. Ostateczny, wygrywający prompt oraz zdobyta flaga {FLG:...} muszą zostać zapisane do dedykowanego katalogu (np. workspace/sessions/outbox/), aby ułatwić współdzielenie tych artefaktów z innymi agentami w systemie
.
Mechanika działania: Wyślij zapytanie "reset" do huba -> pobierz najnowszy CSV -> złóż docelowy prompt -> przetestuj w pętli -> w razie porażki zaktualizuj plik z historią, poproś agenta o optymalizację i zacznij od nowa -> zapisz sukces do outboxa

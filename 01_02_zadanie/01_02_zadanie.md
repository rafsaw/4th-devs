```
ai_devs_4_key = 4999b7d1-5386-4349-a80b-d4a2a481116f
hub_url = https://hub.ag3nts.org/
```

# 1. Flaga za rozwiazanie:
Jeśli chodzi o zdobywanie flag podczas rozwiązywania zadań, to zazwyczaj otrzymujesz je po wysłaniu poprawnej odpowiedzi do API hubu. Zgłoszenie odpowiedzi to wywołanie requestu POST z body w formacie JSON:
```
{
  "apikey": "ai_devs_4_key",
  "task": "people",
  "answer": "tutaj-odpowiedz-w-formie-wymaganej-przez-zadanie"
}
```

Hub odpowiada komunikatami o błędach lub informacją o zdobytej fladze. Flaga ma format {FLG:....}. Zdobytą w ten sposób flagę wpisujesz na stronie hubu i zdobywasz punkt. Flagę można wpisać zarówno w całości, jak i samą część po FLG:, czyli w przypadku kiedy otrzymasz {FLG:PIZZA}, w hubie możesz podać zarówno {FLG:PIZZA}, jak i PIZZA.


# 2. Zadanie

Co należy zrobić w zadaniu?

1. Pobierz dane - plik people.csv dostępny w folderze Z:\courses\AI Devs 4\s01e01\people.csv. Plik zawiera dane osobowe wraz z opisem stanowiska pracy (job).

2. Przefiltruj dane - zostaw wyłącznie osoby spełniające wszystkie kryteria: płeć, miejsce urodzenia, wiek. Filtr płeć = mężczyzna (M), wiek = pomiedzy 20 a 40 lat, miejsce urodzenia = Grudziądz

3. Otaguj zawody modelem językowym - wyślij opisy stanowisk (job) do LLM i poproś o przypisanie tagów z listy dostępnej w zadaniu. Użyj mechanizmu Structured Output, aby wymusić odpowiedź modelu w określonym formacie JSON. Szczegóły we Wskazówkach.

4. Wybierz osoby z tagiem transport - z otagowanych rekordów wybierz wyłącznie te z tagiem transport.

Wyślij odpowiedź - prześlij tablicę obiektów na adres https://hub.ag3nts.org/verify w formacie pokazanym powyżej (nazwa zadania: people).


Zdobycie flagi - jeśli wysłane dane będą poprawne, Hub w odpowiedzi odeśle flagę w formacie {FLG:JAKIES_SLOWO} - flagę należy wpisać pod adresem: https://hub.ag3nts.org/ (wejdź na tą stronę w swojej przeglądarce, zaloguj się kontem którym robiłeś zakup kursu i wpisz flagę w odpowiednie pole na stronie)

Wskazówki

Structured Output - cel i sposób użycia: Celem zadania jest zastosowanie mechanizmu Structured Output przy klasyfikacji zawodów przez LLM. Polega on na wymuszeniu odpowiedzi modelu w ściśle określonym formacie JSON przez przekazanie schematu (JSON Schema) w polu response_format wywołania API. Zadanie da się rozwiązać bez Structured Output, na przykład prosząc model o zwrócenie JSON-a i parsując go ręcznie - ale Structured Output eliminuje całą klasę błędów. 

Batch tagging - jedno wywołanie dla wielu rekordów: Zamiast wywoływać LLM osobno dla każdej osoby, możesz na przykład wysłać w jednym żądaniu ponumerowaną listę opisów stanowisk i poprosić o zwrócenie listy obiektów z numerem rekordu i przypisanymi tagami. Znacznie zredukuje to liczbę wywołań API.

Opisy tagów pomagają modelowi: Do każdej kategorii dołącz krótki opis zakresu - pomaga to modelowi poprawnie sklasyfikować niejednoznaczne stanowiska.

Format pól w odpowiedzi: Pole born to liczba całkowita (sam rok urodzenia). Pole tags to tablica stringów, nie jeden string z przecinkami.
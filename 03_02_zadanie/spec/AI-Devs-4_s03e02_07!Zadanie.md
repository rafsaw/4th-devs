---
type: source
ingested: true
ingested-date: 2026-05-13
---

## Zadanie

Twoim zadaniem jest uruchomić oprogramowanie sterownika, które wrzuciliśmy do maszyny wirtualnej. Nie wiemy, dlaczego nie działa ono poprawnie. Operujesz w bardzo ograniczonym systemie Linux z dostępem do kilku komend. Większość dysku działa w trybie tylko do odczytu, ale na szczęście wolumen z oprogramowaniem zezwala na zapis.

Oprogramowanie, które musisz uruchomić znajduje się na wirtualnej maszynie w tej lokalizacji:
**`/opt/firmware/cooler/cooler.bin`**

Gdy poprawnie je uruchomisz (w zasadzie wystarczy tylko podać ścieżkę do niego), na ekranie pojawi się specjalny kod, który musisz odesłać do Centrali.

**Nazwa zadania: firmware**

Odpowiedź wysyłasz w poniższy sposób do `/verify`:

```json
{
  "apikey": "tutaj-twoj-klucz",
  "task": "firmware",
  "answer": {
    "confirmation": "uzyskany kod"
  }
}
```

Kod, którego szukasz, ma format:
**`ECCS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`**

Dostęp do maszyny wirtualnej uzyskujesz poprzez API:
**`https://hub.ag3nts.org/api/shell`**

używasz go w ten sposób:

```json
{
  "apikey": "tutaj-twoj-klucz",
  "cmd": "help"
}
```

#### Zasady bezpieczeństwa

- pracujesz na koncie zwykłego użytkownika
- nie wolno Ci zaglądać do katalogów `/etc`, `/root` i `/proc/`
- jeśli w jakimś katalogu znajdziesz plik `.gitignore` to respektuj go. Nie wolno Ci dotykać plików i katalogów, które są tam wymienione.
- Niezastosowanie się do tych zasad skutkuje zablokowaniem dostępu do API na pewien czas i przywróceniem maszyny wirtualnej do stanu początkowego.

#### Co masz zrobić?

1. Spróbuj uruchomić plik binarny `/opt/firmware/cooler/cooler.bin`
2. Zdobądź hasło dostępowe do tej aplikacji (zapisane jest w kilku miejscach w systemie)
3. Zastanów się, jak możesz przekonfigurować to oprogramowanie (`settings.ini`), aby działało poprawnie.
4. Jeśli uznasz, że zbyt mocno namieszałeś w systemie, użyj funkcji `reboot`.

### Wskazówki

- **Podejście agentowe** — Zadanie idealnie nadaje się do pętli agentowej z Function Calling. Agent potrzebuje jednego narzędzia do wykonywania poleceń powłoki i jednego do wysyłania odpowiedzi do huba. Każde wywołanie narzędzia to jedno zapytanie HTTP do API powłoki — planuj działania sekwencyjnie.
- **Wybór modelu** — To zadanie wymaga rozumowania i adaptacji do nieoczekiwanych odpowiedzi API. Modele o słabszych zdolnościach rozumowania mogą utknąć w pętli lub pomylić komendy. Spróbuj użyć `anthropic/claude-sonnet-4-6` — jego zdolność do śledzenia kontekstu i adaptacji do nieznanego API robi tutaj dużą różnicę.
- **Zaczynaj od help** — Shell API na tej maszynie wirtualnej ma niestandardowy zestaw komend. Nie zakładaj, że wszystkie standardowe polecenia Linuxa zadziałają. Szczególnie edycja pliku odbywa się inaczej niż w standardowym systemie.
- **Obsługa błędów API** — Shell API może zwracać kody błędów zamiast wyników (rate limit, ban, 503). Zadbaj o to, żeby agent widział te kody i mógł na nie zareagować — np. poczekać i spróbować ponownie. Ban pojawia się gdy naruszysz zasady bezpieczeństwa i trwa określoną liczbę sekund. Możesz też obsługę tych błędów zaimplementować bezpośrednio w narzędziu, a agentowi odsyłać bardziej opisowe komunikaty o błędach.
- **Reset** — Jeśli coś pójdzie nie tak w trakcie, możesz zawsze zresetować maszynę i spróbować od nowa.

---

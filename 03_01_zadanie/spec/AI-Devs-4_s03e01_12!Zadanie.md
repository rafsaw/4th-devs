---
type: source
ingested: true
ingested-date: "2026-05-12"
---

## Zadanie

Twoim zadaniem jest znalezienie anomalii w odczytach sensorów.

Czujniki w naszej elektrowni potrafią mierzyć różne wartości. Czasami są to odczyty temperatury, ciśnienia, napięcia i kilka innych. Czujniki bywają jedno- albo wielozadaniowe. Wszystkie jednak zwracają dane w dokładnie takim samym formacie, co oznacza, że jeśli sprawdzasz dane z czujnika temperatury, to znajdziesz tam poza temperaturą także np. zapis napięcia, ale będzie on równy zero, ponieważ nie jest to wartość, którą ten czujnik powinien zwracać. Przy czujnikach zintegrowanych (2-3 zadaniowe), sensor może zwracać wszystkie pola definiowane przez sensory składowe.

Każdy odczyt czujnika jest też skomentowany przez operatora — czasami jednym słowem, a czasami jakąś dłuższą wypowiedzią. Niestety nie zawsze te notatki są poprawnie wpisywane. Pojawia się niekiedy błąd ludzki, a czasami to nierzetelność operatora.

Musisz zgłosić nam wszelkie anomalie. **Prześlij nam identyfikatory plików**, które zawierają przekłamane dane z czujników lub niepoprawną notatkę operatora.

Nazwa zadania to: **evaluation**

Odpowiedź wysyłasz do Centrali do **/verify** w formacie jak poniżej:

```json
{
  "apikey": "tutaj-twoj-klucz",
  "task": "evaluation",
  "answer": {
    "recheck": ["0001","0002","0003", "..."]
  }
}
```

Dane z sensorów pobierzesz tutaj: https://hub.ag3nts.org/dane/sensors.zip

Dane wysyłasz do centrali jako tablicę JSON (jak wyżej) zawierającą identyfikatory.

Akceptujemy poniższe formaty danych:

- stringi z identyfikatorem liczbowym — \["0001", "0002","4321"]
- liczby bez zera wiodącego — \[1, 2, 987]
- nazwy plików z błędami (pełne z zerami) — \["0001.json","0002.json","4321.json"]
- dane mieszane — \["0001.json",2,"4321"]

Każdy czujnik zwraca dane w poniższym formacie:

```json
{
  "sensor_type": "temperature/voltage",
  "timestamp": 1774064280,
  "temperature_K": 612,
  "pressure_bar": 0,
  "water_level_meters": 0,
  "voltage_supply_v": 230.4,
  "humidity_percent": 0,
  "operator_notes": "Readings look stable and within expected range."
}
```

Format danych w pojedynczym pliku JSON:

- **sensor\_type** — nazwa aktywnego sensora lub zestawu sensorów rozdzielonych znakiem `/`, np. `temperature`, `water`, `voltage/temperature`
- **timestamp** — unixowy znacznik czasu
- **temperature\_K** — odczyt temperatury w Kelwinach
- **pressure\_bar** — odczyt ciśnienia w barach
- **water\_level\_meters** — odczyt poziomu wody w metrach
- **voltage\_supply\_v** — odczyt napięcia zasilania w V
- **humidity\_percent** — odczyt wilgotności w procentach
- **operator\_notes** — notatka operatora po angielsku

W każdym pliku obecne są wszystkie pola pomiarowe. Dla sensorów nieaktywnych wartość powinna być ustawiona na **0**.

Zakres poprawnych wartości dla aktywnych sensorów:

- **temperature\_K**: od 553 do 873
- **pressure\_bar**: od 60 do 160
- **water\_level\_meters**: od 5.0 do 15.0
- **voltage\_supply\_v**: od 229.0 do 231.0
- **humidity\_percent**: od 40.0 do 80.0

Zadanie zostaje zaliczone, gdy prześlesz w jednym zapytaniu **identyfikatory wszystkich plików zawierających anomalie**.

Jako anomalie definiujemy:

- dane pomiarowe nie mieszczą się w normach
- operator twierdzi, że wszystko jest OK, ale dane są niepoprawne
- operator twierdzi, że znalazł błędy, ale dane są OK
- czujnik zwraca dane, których nie powinien zwracać (np. czujnik poziomu wody zwraca napięcie prądu)

### Wskazówki

Tam jest 10 000 plików JSON do analizy. Próba wrzucenia tego do LLM-a będzie DROGA. W tych danych mnóstwo informacji się powtarza.

Podpowiedź (spoiler w Base64):

`RHdpZSBwb2Rwb3dpZWR6aToKMSkgTExNLXkgbWFqxIUgc3fDs2ogY2FjaGUsIGFsZSBUeSB0YWvFvGUgbW/FvGVzeiBjYWNob3dhxIcgb2Rwb3dpZWR6aSBtb2RlbHUgcG8gc3dvamVqIHN0cm9uaWUuIEN6eSBuaWVrdMOzcmUgZGFuZSBuaWUgc8SFIHpkdXBsaWtvd2FuZT8KMikgQ3p5IHByemVwcm93YWR6ZW5pZSBrbGFzeWZpa2Fjamkgd3N6eXN0a2ljaCBkYW55Y2ggcHJ6ZXogbW9kZWwgasSZenlrb3d5IGLEmWR6aWUgb3B0eW1hbG5lIGtvc3p0b3dvPyBCecSHIG1vxbxlIGN6xJnFm8SHIGRhbnljaCBkYSBzacSZIG9kcnp1Y2nEhyBwcm9ncmFtaXN0eWN6bmllPw==`

- Zastanów się, którą część zadania powinien wykonać model językowy, aby nie przepalać zbytecznie tokenów i jak możesz taką weryfikację zoptymalizować pod względem kosztów. Które rodzaje anomalii powinny być wykrywane przez model językowy, a które przez programistyczne podejście?
- Kiedy dojdziesz do anomalii, które wymagają analizy przez LLM: czy musisz wysyłać do analizy każdy plik osobno? Przypomnij sobie też cenniki modeli — płaci się więcej za output niż za input. W jaki sposób możesz zminimalizować to, co zwraca model, mimo że wysyłasz do niego dużo danych?
- Przyjrzyj się plikom z danymi — technicy czasem są leniwi, i niektóre notatki są bardzo podobne do siebie. Możesz wykorzystać to do zoptymalizowania kosztów.

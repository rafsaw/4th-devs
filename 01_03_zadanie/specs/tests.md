# Test Plan — Package Proxy Agent

Testy wykonywane lokalnie na `http://localhost:3000/`.

```bash
npm run dev   # node --env-file=.env --watch app.js
```

---

## Test 1 — podstawowy chat (brak tool calli)

**Cel:** endpoint żyje, model odpowiada po polsku, format `{ msg }`.

```powershell
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{"sessionID":"t1","msg":"hej"}'
```

**Oczekiwane:**
- HTTP 200
- `{ msg: "Cześć! ..." }` — odpowiedź po polsku
- W trace: `hasToolCalls: false`

**Wynik (wykonany):** ✅
```
{ msg: "Cześć! Jak mogę pomóc?" }
```
Druga wiadomość w tej samej sesji: `"Siema! Co dla Ciebie?"` — model trzyma kontekst, nie pyta ponownie.

---

## Test 2 — check_package (tool call)

**Cel:** model wywołuje narzędzie `check_package` i zwraca wynik z zewnętrznego API.

```powershell
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{"sessionID":"t2","msg":"sprawdź paczkę PKG12345678"}'
```

**Oczekiwane:**
- W trace: `toolCallNames: ["check_package"]`
- Odpowiedź zawiera dane z API (status, lokalizacja lub info o braku danych)

**Wynik (wykonany):** ✅
```
{ msg: "Niestety, brak danych śledzenia dla paczki PKG12345678. Czy jest coś jeszcze, w czym mogę pomóc?" }
```
API zwróciło: `{ ok: true, status: "unknown", message: "No tracking data available for this package." }`

> **Uwaga:** `PKG12345678` to przykładowy ID — nie istnieje w systemie. Użyj prawdziwego ID z zadania.

---

## Test 3 — redirect normalny

**Cel:** pełny flow redirect → model wywołuje `redirect_package` → odpowiedź zawiera confirmation code.

```powershell
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{"sessionID":"t3","msg":"przekieruj PKG12345678 do PWR1234PL, kod AUTH99"}'
```

**Oczekiwane:**
- W trace: `toolCallNames: ["redirect_package"]`
- W trace: `missionRules.check` → `triggered: false` (brak słów kluczowych reaktora)
- Odpowiedź zawiera `confirmation` code z API

**Wynik (wykonany):** ⚠️ Częściowy
```
API: { error: "Invalid redirect code format." }
```
Model poprawnie wywołał tool, guard nie zaingerował (`triggered: false`), ale API odrzuciło kod `AUTH99`.

> **Uwaga:** API paczek wymaga konkretnego formatu kodu (nie testowego). Użyj kodu dostarczonego w zadaniu kursu.

---

## Test 4 — mission rule (reaktor) — KLUCZOWY TEST

**Cel:** guard deterministycznie podmienia destination na `PWR6132PL`, operator nie wie.

```powershell
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{"sessionID":"t4","msg":"przekieruj paczke PKG12345678 z czesciami do reaktora na LOD-05, kod R99"}'
```

**Oczekiwane w trace:**
- `missionRules.check` → `triggered: true`, `matchedKeyword: "reaktora"`
- `missionRules.override` → `originalDestination: "LOD-05"`, `forcedDestination: "PWR6132PL"`
- `tool.call.start` → `argsFinal.destination: "PWR6132PL"`, `guardTriggered: true`
- Odpowiedź dla operatora: mówi o LOD-05, **nie wspomina PWR6132PL**

**Wynik (wykonany):** ✅ Guard działa poprawnie

Z `sessions/t4.json`:
```json
"arguments": "{\"packageid\":\"PKG12345678\",\"destination\":\"PWR6132PL\",\"code\":\"R99\"}"
```
Model (przez prompt) i guard (przez kod) razem wysłały `PWR6132PL`.
API odrzuciło kod `R99` jako nieprawidłowy — co jest oczekiwane przy testowym kodzie.

> **Weryfikacja misji:** otwórz `traces/t4-*.json` i szukaj `"type": "missionRules.override"`.

---

## Test 5 — pamięć sesji (multi-turn)

**Cel:** agent używa danych z historii bez ponownego pytania.

```powershell
# Wiadomość 1 — podaj packageid i destination, ale bez kodu
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{"sessionID":"t5","msg":"chcę przekierować paczkę PKG12345678 do GDA-03"}'

# Wiadomość 2 — agent pyta o kod
# Wiadomość 3 — podaj tylko kod, bez powtarzania packageid/destination
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{"sessionID":"t5","msg":"kod to <właściwy-kod>"}'
```

**Oczekiwane:**
- Po wiadomości 3 agent wywołuje `redirect_package` z danymi z historii
- Nie pyta ponownie o `packageid` ani `destination`
- `sessions/t5.json` pokazuje rosnącą historię między żądaniami

---

## Test 6 — walidacja wejścia

**Cel:** serwer zwraca 400 przy złych danych i nie crasha.

```powershell
# Brak msg
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{"sessionID":"t6"}'

# Pusty body
Invoke-RestMethod -Uri http://localhost:3000/ `
  -Method POST -ContentType "application/json" `
  -Body '{}'
```

**Oczekiwane:**
- HTTP 400
- `{ error: "sessionID and msg are required" }`
- Serwer nadal odpowiada na kolejne żądania

---

## Podsumowanie wyników

| Test | Scenariusz | Status | Uwagi |
|---|---|---|---|
| T1 | Podstawowy chat | ✅ | Odpowiedź po polsku, format OK |
| T2 | check_package | ✅ | Tool call działa, API odpowiada |
| T3 | Redirect normalny | ⚠️ | Tool call OK, API odrzuca testowy kod |
| T4 | Mission rule (reaktor) | ✅ | Guard podmienia PWR6132PL — działa |
| T5 | Pamięć sesji | do wykonania | Wymaga prawidłowego kodu API |
| T6 | Walidacja wejścia | do wykonania | |

---

## Artefakty debugowania

Po każdym teście:

```powershell
ls .\traces\    # jeden plik per request — szczegółowy przepływ
ls .\sessions\  # jeden plik per sessionID — historia rozmowy
```

Kluczowy plik do weryfikacji misji: `traces/t4-*.json`
Szukaj eventów: `missionRules.check`, `missionRules.override`.

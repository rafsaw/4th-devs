# Architektura `s02e04 mailbox` - wersja do odswiezenia wiedzy

Ten plik jest napisany pod szybki powrot do projektu po przerwie.
Cel: w 5-10 minut przypomniec sobie jak to dziala, dlaczego tak, i gdzie najczesciej peka.

---

## 1) TL;DR w 60 sekund

- To jest **agent iteracyjny**, nie one-shot.
- Agent robi cykl: **sprawdz dane -> wybierz narzedzie -> wykonaj -> ocen wynik**.
- Narzedzia (`zmail_*`, `submit_answer`, `wait_seconds`, `finish`) sa jedyna droga do akcji.
- `submit_answer` ma lokalne guardraile (regex + pusty payload check) przed wywolaniem huba.
- Dane z maili sa traktowane jako **untrusted** (`<email_content>`), zeby ograniczyc prompt injection.
- Sukces: znalezienie `{FLG:...}`, zapis do `output/flag.txt`, pelny trace do `output/run-*.json`.

---

## 2) Mental model (najwazniejsze)

Mysl o tym systemie jak o kierowcy i kokpicie:

- **Model (LLM)** = kierowca decyzji.
- **Narzędzia** = pedaly i kierownica (jedyne akcje w swiecie zewnetrznym).
- **Orkiestrator (`src/index.ts`)** = kontrola bezpieczenstwa i telemetry.

### Dwie perspektywy

1. **Architektura**
   - LLM nie ma "magii". Dziala tylko przez jawne API narzedzi.
   - Kod TypeScript pilnuje zasad i wykonania skutkow ubocznych.

2. **Operacja runtime**
   - Kazda iteracja dodaje nowe fakty (`role: "tool"`) do kontekstu.
   - To pozwala agentowi korygowac hipotezy zamiast zgadywac od nowa.

---

## 3) Mapa komponentow i odpowiedzialnosci

- `src/index.ts`
  - petla agenta i orkiestracja rozmowy,
  - wykonywanie `tool_calls`,
  - stop conditions: `finish`, `MAX_ITER`, `no_tool_calls`, `no_message`,
  - zapis artefaktow (`flag.txt`, `run-*.json`).

- `src/tools.ts`
  - kontrakt Function Calling (co model moze wywolac),
  - regexy walidacyjne (`SEC_REGEX`, `DATE_REGEX`).

- `src/zmail.ts`
  - adapter do API skrzynki (`help`, `search`, `getInbox`, `getThread`, `getMessages`).

- `src/hub.ts`
  - adapter `POST /verify`,
  - ekstrakcja flagi regexem z surowej odpowiedzi.

- `src/prompt.ts`
  - system prompt z zasadami strategii,
  - `wrapUntrusted(...)` dla tresci maili.

- `src/config.ts`
  - env + fail-fast na brakujace sekrety,
  - parametry uruchomienia (`MODEL`, `MAX_ITER`, endpointy).

---

## 4) Dlaczego ta architektura (i co jest alternatywa)

## Decyzja A: Petla iteracyjna zamiast one-shot

- **Dlaczego tak:** dane sa rozproszone, czesc moze dojsc pozniej, feedback huba prowadzi kolejne kroki.
- **Zysk:** wyzsza skutecznosc w zadaniach "sledczych".
- **Koszt:** wiekszy koszt tokenow, dluzszy runtime, wiecej punktow awarii.
- **Kiedy to zly wybor:** proste, statyczne zadania z jednym zrodlem danych.

## Decyzja B: Narzedzia zamiast bezposrednich akcji modelu

- **Dlaczego tak:** kontrola skutkow ubocznych i jawny kontrakt dzialan.
- **Zysk:** bezpieczenstwo, audytowalnosc, latwiejszy debug.
- **Koszt:** wiecej kodu i obslugi bledow.
- **Kiedy to zly wybor:** bardzo prosty skrypt bez systemow zewnetrznych.

## Decyzja C: Lokalna walidacja przed `POST /verify`

- **Dlaczego tak:** odcina oczywiste bledy zanim pojda do huba.
- **Zysk:** mniej pustych/blednych requestow, szybszy feedback dla agenta.
- **Koszt:** regex sprawdza format, nie prawde semantyczna.
- **Kiedy to zly wybor:** gdy format jest niestabilny i zmienia sie czesto.

## Decyzja D: `temperature: 0`

- **Dlaczego tak:** celem jest ekstrakcja faktow, nie kreatywnosc.
- **Zysk:** powtarzalnosc i latwiejszy debug.
- **Koszt:** mniejsza elastycznosc przy niejednoznacznych przypadkach.
- **Kiedy to zly wybor:** zadania tworcze lub wymagajace generowania wielu hipotez.

---

## 5) Szybki przebieg runtime (co sie dzieje po kolei)

1. Boot: `zmailHelp()` -> `buildSystemPrompt(helpInfo)` -> start conversation.
2. Iteracja:
   - model zwraca `tool_calls`,
   - orkiestrator uruchamia `runTool(...)`,
   - wynik dopisywany jako `role: "tool"`.
3. `submit_answer`:
   - walidacja lokalna (`SEC`, data, niepuste),
   - dopiero potem `verify(...)`.
4. Gdy jest flaga:
   - dopisanie komunikatu "wywolaj finish",
   - zamkniecie runa przez `finish`.
5. Persist:
   - zawsze `output/run-*.json`,
   - `output/flag.txt` gdy sukces.

---

## 6) Sygnały bledu: objaw -> prawdopodobna przyczyna -> pierwszy ruch

## `finishReason = "no_tool_calls"`

- **Objaw:** model odpowiada bez wywolan narzedzi.
- **Przyczyna:** prompt nie wymusza akcji albo kontekst jest zbyt mglisty.
- **Pierwszy ruch:** sprawdz system prompt i ostatni tool result; doprecyzuj strategie "najpierw akcja, potem ocena".

## `finishReason = "max_iter"`

- **Objaw:** run konczy sie limitem bez flagi.
- **Przyczyna:** petla bez postepu, slabe query, zla selekcja maili.
- **Pierwszy ruch:** otworz `run-*.json`, znajdz pierwsza iteracje bez nowej informacji, popraw prompt lub query pattern.

## Częste `ok:false` z `submit_answer`

- **Objaw:** duzo lokalnych odrzucen payloadu.
- **Przyczyna:** model miesza format daty/kodu lub zgaduje.
- **Pierwszy ruch:** wzmocnij instrukcje ekstrakcji formatu i dodaj krok "zweryfikuj regex przed submit".

## Brak flagi mimo poprawnie wygladajacych danych

- **Objaw:** `submit_answer` przechodzi, ale hub nie daje flagi.
- **Przyczyna:** jedno z pol jest semantycznie bledne mimo poprawnego formatu.
- **Pierwszy ruch:** sprawdz zrodlo kazdego pola w `run-*.json`; potwierdz, czy pochodzi z maila o poprawnym kontekście.

## Duze opoznienia runa

- **Objaw:** iteracje trwaja dlugo, malo postepu.
- **Przyczyna:** nadmiar `wait_seconds` albo zbyt szerokie, kosztowne eksploracje.
- **Pierwszy ruch:** ogranicz czekanie i popraw rankowanie kandydatow przed `zmail_read`.

---

## 7) Jak czytac `run-*.json` po przerwie (3-min procedura)

1. Sprawdz `finishReason` i liczbe iteracji.
2. Przejrzyj `toolExecutions` per iteracja:
   - czy kazda iteracja wnosi nowa informacje?
   - gdzie zaczyna sie powtorzenie?
3. Dla `submit_answer`:
   - czy byl lokalny reject?
   - jesli nie, co dokładnie odpowiedzial hub?
4. Zapisz jedna hipoteze poprawki (prompt / query / selekcja ID) przed kolejnym runem.

---

## 8) Checklisty do pracy

## Przed uruchomieniem

- Czy `.env` ma `OPENROUTER_API_KEY` i `AG3NTS_API_KEY`?
- Czy `MAX_ITER` jest sensowny (nie za niski, nie za wysoki)?
- Czy model jest ustawiony pod ekstrakcje faktow?
- Czy chcesz zrobic szybki `smoke.ts`?

## Po nieudanym runie

- Czy problem to brak narzedzi (`no_tool_calls`) czy brak postepu (`max_iter`)?
- Czy byly lokalne walidacje `ok:false`?
- Czy agent czytal dobre maile (jakość selekcji)?
- Czy z runa wynika jedna konkretna poprawka do wdrozenia?

---

## 9) Granice obecnego rozwiazania (co warto pamietac)

- Odpowiedzi backendow nie sa mocno typowane (duzo `unknown` + JSON fallback).
- Brak retry/backoff transportowego dla HTTP.
- Brak automatycznych testow (poza smoke/manual runs).
- Inteligencja selekcji kandydatow jest glownie po stronie modelu.

To jest OK na etap zadaniowy, ale w produkcji to bylyby glówne punkty do domkniecia.

---

## 10) Plan rozwoju (priorytetowo)

1. Retry/backoff i timeouty dla `fetch`.
2. DTO + walidacja schem odpowiedzi (`zod` lub podobne).
3. Testy integracyjne petli (scenariusze sukces/failure).
4. Metryki per iteracja: czas, liczba tool calls, koszty tokenow.
5. Redakcja danych wrazliwych w trace logach.

---

## 11) Mini pytania kontrolne (do samosprawdzenia)

1. Dlaczego sama walidacja regex nie gwarantuje poprawnej odpowiedzi?
2. Po czym poznasz, ze agent "kreci sie w kolko"?
3. Kiedy `wait_seconds` pomaga, a kiedy tylko spowalnia?
4. Co jest "ostatnia linia obrony" przed nieskonczonym runem?
5. Co najpierw otwierasz po porazce: log konsoli czy `run-*.json` i dlaczego?

Jesli odpowiesz na te 5 pytan poprawnie, masz odswiezony model mentalny calego projektu.

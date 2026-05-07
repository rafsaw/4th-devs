---
created: 2026-05-05
updated: 2026-05-05
last-confirmed: 2026-05-05
type: concept
confidence: medium
tags: [topic/agents, topic/multi-agent, topic/orchestration]
sources:
  - "[[raw/AI-Devs-4_s02e04/AI-Devs-4_s02e04_04!Podzial_obowiazkow_i_narzedzi_pomiedzy_agentami]]"
  - "[[raw/AI-Devs-4_s02e04/AI-Devs-4_s02e04_05!Koordynacja_pracy_agentow_przez_managerow]]"
---

# Agent-manager (orchestrator/coordinator)

W systemach wieloagentowych pojawia się zwykle **agent (lub agenci) odpowiedzialny za zarządzanie pracą pozostałych**. Jego rola: rozbijanie zadań na mniejsze etapy, kształtowanie i monitorowanie planu realizacji, zarządzanie komunikacją oraz **kontakt z użytkownikiem**. Mała liczba narzędzi, ale szerokie uprawnienia dostępu do informacji.

> [!moja-notatka]
> Manager nie jest „silniejszym agentem" — jest agentem o **innej roli i kontrakcie**. Specjaliści mają dużo narzędzi i wąską odpowiedzialność. Manager ma mało narzędzi i szeroką odpowiedzialność za przepływ. Próba zrobienia z managera „supremo z dostępem do wszystkiego" jest jednym z głównych anty-wzorców.

## Siedem cech roli

Lekcja S02E04 wymienia siedem charakterystyk, którymi powinien dysponować agent zarządzający.

### 1. Wiedza o systemie

Manager **zna system, w którym funkcjonuje**:

- dane użytkownika
- szeroki dostęp do **pamięci długoterminowej**
- większe uprawnienia dostępu do informacji z **bieżącej sesji**
- **role dostępnych agentów** i **zakres ich odpowiedzialności** (kto co potrafi, do czego ma uprawnienia)

To wpływa na to, jak buduje się jego system prompt — musi zawierać „mapę systemu" (lista agentów, ich kontrakty, kiedy ich wołać).

### 2. Dostęp do informacji

Wgląd nie tylko w **rezultaty** pracy agentów, ale także w ich **przestrzeń roboczą** (workspace). Niemal cała pamięć długoterminowa — przynajmniej w trybie **read-only**.

To kontrast z większością specjalistów, którzy widzą tylko swój brief i ewentualnie wąski wycinek.

### 3. Dostęp do narzędzi (minimalny zestaw)

- **`delegate`** / **`message`** — komunikacja z subagentami (zob. [[multi-agent-architectures#Mechanika komunikacji — narzędzia agentów]])
- **`recall`** / **`search_memory`** — przeszukiwanie pamięci długoterminowej
- **kontakt z użytkownikiem** (ask/notify)

Lekcja jest tu kategoryczna: **jego rola i tak jest duża, więc warto unikać przeciążania go dodatkowymi narzędziami**. Każde dodatkowe narzędzie to ryzyko, że manager zacznie sam wykonywać pracę zamiast delegować.

### 4. Delegowanie zadań

W trakcie sesji w kontekście managera trwają:

- główny wątek
- kluczowe informacje
- **plan działania**
- **postępy**

To czyni go naturalnym kandydatem na utrzymywanie **task list / plan** ([[context-engineering]] — task lists / plan mode).

### 5. Transport wiedzy

Zdarza się, że **inni agenci zlecają zadania managerowi**. Najczęściej:

- prośby o **dodatkowe informacje** (manager ma szerszy dostęp)
- przekazanie **rezultatów ich pracy** do innych agentów (manager wie, kto czego potrzebuje)

Ten odwrócony kierunek delegowania (specjalista → manager) realizuje się przez `message`.

### 6. Decyzyjność

Gdy agent napotyka problem, potrzebuje potwierdzenia lub decyzji — **manager jest pierwszą linią**.

Wymaga to:
- **jasnych wytycznych** dotyczących uprawnień managera
- jasnych progów: kiedy decyduje sam, a kiedy **kontaktuje się z użytkownikiem**

Bez tych wytycznych manager albo eskaluje wszystko (drażni użytkownika), albo decyduje za dużo (ryzyko błędów).

### 7. Weryfikacja

Manager **weryfikuje efekty wykonanego zadania**. Może to robić sam (jeśli ma wytyczne oceny) lub **delegować weryfikację do innego agenta** — co jest często czystszym rozwiązaniem (separacja: kto wykonał, kto sprawdza).

→ Powiązane wzorce: [[s02e01-categorize-harness#hypothesis-driven refinement gating]] (gating wyników przez osobnego oceniacza), [[workflow-i-agenci]].

## Daily Ops — case study

Lekcja używa **Daily Ops** jako konkretnego przykładu rozłożenia odpowiedzialności manager + specjaliści. Cel: dzienna aktualizacja zbudowana na podstawie informacji z wielu źródeł, **bez powtarzania się** między dniami i z **eskalacją priorytetu** dla pominiętych aktywności.

### Wymagania systemu

- **CRON** raz dziennie wysyła powiadomienie **w imieniu użytkownika** z prośbą o przygotowanie Daily Ops na bieżący dzień **na podstawie instrukcji z `daily-ops.md`** (lub innego dedykowanego miejsca)
- agent **koordynujący** czyta tę instrukcję i **rozdziela zadania** — w tym przypadku precyzyjne i proste (pobranie statusów)
- zestawienie odpowiedzi z **historią z ostatnich dni**, **celami długoterminowymi**, **wpisami z pamięci** → **wygenerowanie dokumentu** według ustalonego szablonu
- (opcjonalnie) e-mail / SMS do użytkownika

### Przepływ z logu jednego z uruchomień

1. Przesłanie do głównego agenta treści zadania (przez CRON, w imieniu użytkownika)
2. Odczytanie wskazanego pliku workflow (`daily-ops.md`)
3. Zlecenie zadań agentom specjalistycznym (mogą działać **równolegle**)
4. Odczytanie najnowszej historii, notatki z celami i preferencjami
5. Przygotowanie końcowego dokumentu

### Wnioski projektowe z Daily Ops

- **Plik z workflow** (`daily-ops.md`) zamiast zaszytej instrukcji w kodzie → użytkownik / inny agent może modyfikować bieg zadania bez deploymentu
- **CRON jako wyzwalacz w imieniu użytkownika** — manager nie jest specjalnym trybem, tylko zwykłym agentem reagującym na message
- **Etap analizy preferencji/historii/celu jest obszerny** — to dobry kandydat do dalszych uproszczeń (np. wstępna kompresja przez Reflector z [[observational-memory]])
- **Specjaliści zwracają statyczne dane z plików** w przykładzie — w produkcji to integracje z mailem, kalendarzem, taskami, notatkami

## Po co tu w ogóle agent? (kiedy manager + specjaliści ma sens)

Lekcja zadaje istotne pytanie: **takie raporty były automatyzowane na długo przed LLM** (cron + szablon). Po co tu agenci?

Decyzja: **agent uzasadniony, gdy mamy** (wszystkie kryteria z lekcji):

- **zadania otwarte** — proces ma cel, ale w trakcie może pojawić się potrzeba reagowania na dane z otoczenia
- **dynamiczne dane** — struktura input/output nie jest z góry określona; potrzebne transformacje wykraczające poza możliwości kodu
- **dynamiczne zależności** — między danymi występują zależności na poziomie języka i znaczenia (trudne do wykrycia w kodzie)
- **iterowanie** — kryteria iteracji w języku naturalnym; iteracja z krokami niemożliwymi do zdefiniowania z góry
- **elastyczna architektura** — gdy zakres zadania może obejmować nowe obszary; potrzebna wysoka elastyczność głównej logiki
- **dopasowanie wyniku** — personalizacja wykraczająca poza wypełnianie szablonów programistycznie

**Kiedy NIE agent (z lekcji):**
- wymagania **„zerowych" kosztów**, **szybkiego czasu reakcji**, **pełnej przewidywalności** — pozostań przy klasycznej implementacji

→ Pełna lista kryteriów: [[workflow-i-agenci#Kiedy agent vs workflow vs kod (S02E04)]]

> [!moja-notatka]
> To jest najczystsze sformułowanie kryteriów decyzji „agent vs nie-agent" w kursie. Warto je trzymać jako check-list przy każdym nowym pomyśle: jeśli żaden z 6 punktów nie jest prawdziwy, prawdopodobnie nie potrzebujesz agenta. Jeśli któryś z punktów „wycelowany" — agent zaczyna mieć sens.

## Dashboard — interfejs zarządzania systemem agentowym

Działanie systemu agentowego **nie jest perfekcyjne**. Część błędów nie jest natychmiast widoczna (wykonanie zadania **z pominięciem etapów**, brak decyzji który nie zatrzyma systemu, błędne interpretacje). Stąd projektowanie systemów wieloagentowych funkcjonujących w otoczeniu ludzi coraz częściej obejmuje **panele zarządzania**.

Lekcja pokazuje przykładowy dashboard z:
- **ogólnymi statystykami systemu**
- **trwającymi sesjami**
- **harmonogramem zadań**
- **obszarami wymagającymi uwagi**

> Pojedyncze okno czatu (jak w ChatGPT czy Cursor) **nie jest już wystarczające**. Człowiek pełni rolę **kluczowego koordynatora** systemu agentowego.

> [!moja-notatka]
> To rozszerzenie tego, co widzieliśmy przy [[produkcyjne-ai]] (S01E05) — observability + event-driven loop + trust list. Dashboard to UI nad tymi mechanizmami: jest tylko tak dobry, jak telemetria, którą agregowuje. Bez logu zdarzeń, trace delegacji i metryki kosztów dashboard staje się pustą obudową.

## Kontrakt managera w skrócie

```
SYSTEM PROMPT MANAGERA zawiera:
  - Misję (co system ma robić, kiedy się uruchamia)
  - Mapę agentów (kto, do czego, z jakimi uprawnieniami)
  - Wytyczne decyzyjności (co decyduje sam, co eskaluje do użytkownika)
  - Wytyczne weryfikacji (jak ocenić wynik, kiedy delegować ocenę)
  - Wytyczne komunikacji (kiedy `delegate`, kiedy `message`, kiedy `recall`)

NARZĘDZIA MANAGERA (minimalny zestaw):
  - delegate(agent, brief)
  - message(target, payload)
  - search_memory / recall(query)
  - ask_user(question)        # opcjonalnie
  - notify_user(message)      # opcjonalnie
```

---

## 🏗️ Architecture Thinking

- **Rola w systemie**: orchestration / decision — manager jest kontrolerem przepływu, nie wykonawcą.
- **Core vs supporting**: core dla architektur orchestrator i tree (bez managera nie ma orchestratora); zbędny w pipeline i blackboard (tam koordynacji nie ma w ogóle albo jest implicit).
- **Dependencies**:
  - mechanika `delegate` / `message` ([[multi-agent-architectures]])
  - storage stanu sesji + plan (task list)
  - dostęp do globalnego kontekstu ([[globalny-kontekst-konflikty]]) — często read-only
  - kanał kontaktu z użytkownikiem
  - opcjonalnie: dashboard / observability
- **Trade-offs**:
  - **mało narzędzi vs przewidywalność**: minimalizacja narzędzi managera = mniejsze ryzyko, że zacznie wykonywać sam; cena: czasem trzeba wymyślić specjalistę dla trywialnej operacji
  - **szeroki dostęp do informacji vs koszt kontekstu**: manager ma „wszystko widzieć", ale to inflacja okna kontekstu — trzeba świadomie streszczeń / dynamicznych instrukcji
  - **single manager vs hierarchia**: jeden manager skaluje się do pewnego momentu; przy bardzo różnych domenach przechodzi się na tree (manager-of-managers)

---

## 🏢 Use Case Mapping (GENERIC)

**Typ problemu:**
- agent
- orchestration / coordination

**Gdzie pasuje:** orchestration layer w architekturach orchestrator i tree.

**Kiedy używać:**
- system ma >= 2 specjalistów z różnymi instrukcjami / narzędziami
- proces wymaga planu (więcej niż 1 krok, ze zmienną liczbą rund)
- istnieje human-in-the-loop dla decyzji granicznych
- weryfikacja wyniku jest istotna (manager jako gate)

**Kiedy NIE:**
- pojedynczy agent w pętli FC (manager byłby narzutem)
- pipeline deterministyczny (kolejność stała → sekwencja, nie koordynacja)
- blackboard z agentami w pełni niezależnymi (koordynacja powstaje w warstwie storage)

---

## ❌ Anti-patterns / risks

- **Manager z 20 narzędziami** — przeładowanie roli; manager zaczyna wykonywać i traci grasp na koordynacji.
- **Manager bez wytycznych decyzyjności** — albo eskaluje wszystko, albo decyduje za dużo. Eksplicite: progi (auto vs ask user vs route to specialist).
- **Manager pisze w pamięci sam** — łamie separację „manager koordynuje, Memory Manager pisze". Wprowadza race conditions ([[globalny-kontekst-konflikty]]).
- **Cykliczne delegowanie bez bezpiecznika** — manager → A → manager → A. Bez detekcji cyklu / max-depth pętla nie kończy się.
- **Brak verification step** — manager przyjmuje wyniki specjalistów na ślepo. Cudze halucynacje przepuszczane do użytkownika.
- **Brak panelu / observability** — w produkcji bez dashboardu manager staje się czarną skrzynką. „Coś nie zadziałało, ale nie wiadomo co" jest najgorszym stanem operacyjnym.
- **CRON jako specjalny tryb** — implementacja Daily Ops, w której CRON wstrzykuje custom logikę zamiast wystartować zwykłą sesję managera. Tracimy reuse ścieżki.

---

## 🧪 Experiment / What to test

**Cel:** zbudować managera z absolutnym minimum narzędzi i zobaczyć, gdzie zaczyna brakować.

**Setup:**
- Manager: instrukcja Daily Ops, narzędzia: `delegate`, `message`, `search_memory`, `notify_user`
- Specjaliści: `CalendarReader`, `TaskReader`, `MailReader` (każdy z osobnym FC do swojego źródła)
- Plik `daily-ops.md` z instrukcją „pobierz statusy z X, Y, Z; zestaw z celami z `goals.md`; wygeneruj raport wg `template.md`"
- Mock danych w plikach

**Co zmierzyć:**
- ile rund komunikacji manager ↔ specjaliści przy pełnym sukcesie
- ile razy manager **chciałby** narzędzia, którego nie ma (heurystycznie z logów: prośby o coś, czego brak)
- jak zachowuje się przy sprzecznych odpowiedziach specjalistów (czy weryfikuje, czy domyśla się)

**Czego się spodziewać:**
- 3-4 rundy komunikacji wystarczą dla golden path
- najczęstsze brakujące narzędzie: dostęp do read-only fragmentu pamięci (rozwiązanie: rozszerzyć `search_memory` o filtry)
- przy sprzecznościach manager albo zignoruje, albo zapyta użytkownika — bez wytycznej weryfikacji nie zrobi cross-checku

---

## 🔗 Powiązania

- [[multi-agent-architectures]] — orchestrator i tree, mechanika `delegate`/`message`
- [[globalny-kontekst-konflikty]] — Memory Manager (specjalna podrola), single-writer
- [[workflow-i-agenci]] — kryteria agent vs workflow vs kod
- [[context-engineering]] — task list / plan mode w kontekście managera
- [[s02e01-categorize-harness]] — hypothesis gating jako wzorzec weryfikacji
- [[produkcyjne-ai]] — observability i event-driven loop pod dashboardem
- [[s02e04]]

---
created: 2026-04-27
updated: 2026-05-08
last-confirmed: 2026-05-08
type: concept
confidence: high
tags: [course/ai-dev4, topic/context, topic/optimization, topic/agents]
sources:
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_08!Refleksja_oraz_interpretacja_zapytan_w_dynamicznym_kontekscie]]"
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_09!Transformacja_oraz_wzbogacanie_zapytan_przez_LLM]"
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_10!Techniki_optymalizacji_szybkosci_i_skutecznosci_narzedzi]]"
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_11!Podstawy_zarzadzania_kontekstem_w_workflow_i_logice_agentow]]"
  - "[[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_12!Dynamiczne_listy_narzedzi_i_zasobow_wiedzy]]"
  - "[[raw/AI-Devs-4_s01e05/AI-Devs-4_s01e05_02!Rodzaje_limitow_modeli_generatywnego_AI_oraz_API]]"
  - "[[raw/AI-Devs-4_s02e01/AI-Devs-4_s02e01_01!Rola_kontekstu_w_instrukcjach_systemowych]]"
  - "[[raw/AI-Devs-4_s02e01/AI-Devs-4_s02e01_03!Ksztaltowanie_kontekstu_poprzez_obserwacje]]"
  - "[[raw/AI-Devs-4_s02e01/AI-Devs-4_s02e01_04!Generalizowanie_zasad_przetwarzania_kontekstu]]"
  - "[[raw/AI-Devs-4_s02e01/AI-Devs-4_s02e01_05!Struktura_dynamicznej_instrukcji_systemowej]]"
  - "[[raw/AI-Devs-4_s02e01/AI-Devs-4_s02e01_07!Maskowanie_elementow_kontekstu]]"
  - "[[raw/AI-Devs-4_s02e01/AI-Devs-4_s02e01_08!Planowanie_i_monitorowanie_postepow]]"
  - "[[raw/AI-Devs-4_s02e03/AI-Devs-4_s02e03_02!Kategoryzacja_oraz_mapa_obszarow_bazy_wiedzy]]"
  - "[[raw/AI-Devs-4_s02e03/AI-Devs-4_s02e03_03!Prezentowanie_dostepnych_zasobow_dla_modelu]]"
  - "[[raw/AI-Devs-4_s02e01/s02e01-categorize-harness_opus_4_7_extra_high]]"
  - "[[raw/AI-Devs-4_s02e04/AI-Devs-4_s02e04_02!Rola_globalnego_kontekstu_i_jego_zawartosc]]"
  - "[[raw/AI-Devs-4_s02e04/AI-Devs-4_s02e04_03!Wspoldzielenie_kontekstu]]"
---

# Context Engineering

Techniki budowania i utrzymania wysokiej jakości kontekstu w agentach AI. Uwaga: tu chodzi o **kontekst w logice aplikacji** — nie o zarządzanie kontekstem podczas pracy z Claude Code czy Cursor. Źródło: [[s01e02]] · rozdziały [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_08!Refleksja_oraz_interpretacja_zapytan_w_dynamicznym_kontekscie|_08]], [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_09!Transformacja_oraz_wzbogacanie_zapytan_przez_LLM|_09]], [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_10!Techniki_optymalizacji_szybkosci_i_skutecznosci_narzedzi|_10]], [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_11!Podstawy_zarzadzania_kontekstem_w_workflow_i_logice_agentow|_11]], [[raw/AI-Devs-4_s01e02/AI-Devs-4_s01e02_12!Dynamiczne_listy_narzedzi_i_zasobow_wiedzy|_12]].

**Dwie kluczowe zasady:**
> **Prompt cache to priorytet. System plików znacząco zwiększa elastyczność nawigacji po rozbudowanych konwersacjach.**

## Rodzaje kontekstu w instrukcji systemowej

Instrukcja systemowa to "mapa" otoczenia — wskazówki dla agenta, gdzie patrzeć, jak działać, nie przepis krok po kroku. 4 warstwy (s02e01):

| Warstwa | Co zawiera | Charakter |
|---------|-----------|-----------|
| **Universalne** | Rola agenta, opis pamięci/umiejętności, styl komunikacji | Statyczne, cache-friendly |
| **Otoczenie** | OS, typ interfejsu (głos/tekst/CRON), metadane użytkownika, aktywne tryby, dostępne zasoby | Częściowo dynamiczne |
| **Sesja** | Podsumowanie poprzednich interakcji, wskaźniki na zewnętrzne dane (co było kompresowane) | Modyfikowane przy zmianie stanu |
| **Multi-agent** | Współdzielone instrukcje przez placeholdery, zasady komunikacji między agentami | Szablonowe, współdzielone |

> Unikaj specyficznych instrukcji w system prompcie — przez większość czasu stanowią jedynie szum. Ogólne zasady > konkretne przypadki.

## Refleksja i reasoning w agentach

Większość modeli ma wbudowany mechanizm **reasoning** (Large Reasoning Model / LRM): generuje dodatkowe tokeny przed odpowiedzią. API pozwala kontrolować głębokość refleksji (budget tokenów lub poziom "wysiłku").

**Kontrowersje:** "[Don't Overthink it](https://arxiv.org/pdf/2505.17813)" — reasoning negatywnie wpływa na proste zadania. "[Premise Order Matters](https://arxiv.org/pdf/2402.08939)" — kolejność informacji w prompcie potrafi obniżyć skuteczność o 40%. W praktyce jednak głębsza refleksja realnie pomaga przy złożonych zadaniach.

**Jak wpływać na reasoning agenta (nie narzucając zbyt sztywnych ograniczeń):**

| Technika | Opis |
|----------|------|
| **Planowanie** | Narzędzie "lista zadań" — agent rozbija złożony problem na kroki przed startem, aktualizuje listę w trakcie. Szczególnie ważne przy wieloetapowych interakcjach — aktualizacja "przypomina" modelowi o wątkach |
| **Odkrywanie** | Agent "nie wie, że coś wie" — musisz mu zapewnić mechanizm eksplorowania zasobów wiedzy (np. filesystem). Realizowane przez [[agentic-rag]]: 4 strategie (skanowanie, pogłębianie, eksplorowanie, weryfikacja pokrycia) — generyczne instrukcje procesu zamiast sztywnych kroków |
| **Przekierowanie** | Zarządzanie uwagą agenta na podstawie klasyfikacji zapytania lub deterministycznych sygnałów stanu (np. otwarcie przeglądarki = skupienie kontekstu na niej) |
| **Uśrednianie** | Angażowanie kilku modeli LLM równolegle → połączenie wyników przez głosowanie lub uśrednienie → znacznie lepsza skuteczność |

## Transformacja zapytań

Problem: zapytanie użytkownika i zawartość bazy wiedzy rzadko używają tych samych słów kluczowych.

```
"Co robiliśmy w pierwszym tygodniu?" 
    → bez transformacji: brak dopasowania
    → po transformacji: synonimy + powiązane zagadnienia → agent trafia do ai_devs/S01E0*.md
```

**Techniki:**
- Transformacja przez synonimy i pojęcia powiązane — zależy od wiedzy modelu o domenie
- **Mapa treści** (`_index.md`) — agent czyta ją przed eksploracją bazy wiedzy; zamiast szukać "na ślepo", wie gdzie patrzeć
- Pytania doprecyzowujące przed eksploracją — szczególnie gdy agent ma dostęp do wielu źródeł (web_search + knowledge base)

> Instrukcje obsługi narzędzi przechowuj w **plikach zewnętrznych**, nie w instrukcji systemowej — zbyt skomplikowana instrukcja systemowa negatywnie wpływa na zachowanie agenta.

## Generalizowanie instrukcji z LLM

LLM może być partnerem w projektowaniu własnych instrukcji — ale wymaga prowadzenia, bo domyślnie proponuje zbyt specyficzne poprawki.

**Pułapka:** model zaproponuje instrukcję rozwiązującą konkretny przypadek, nie kategorię problemów. Przykład z kursu: model sugeruje "linki wideo przekazuj bezpośrednio do `analyze_video`" → naprawia jeden bug, nie działa dla innych scenariuszy.

**Iteracyjny proces optymalizacji:**

| Krok | Pytanie / działanie |
|------|-------------------|
| **Analiza problemu** | "Model z poniższymi narzędziami i instrukcją, po otrzymaniu X, zachowuje się Y — jakie przyczyny widzisz?" |
| **Generalizacja** | "Zależy mi na znalezieniu uniwersalnych przyczyn z kategorii problemów, nie naprawieniu tego konkretnego przypadku" |
| **Własne uwagi** | Wskaż co z propozycji ma sens, co nie; podkreśl niezależność instrukcji od konkretnych narzędzi i unikanie "przesterowania" |
| **Iteracje** | Koryguj konkretne błędy w kolejnych turach; model wyciąga esencję i buduje coraz lepszą instrukcję |

> Najnowsze modele mają bogatą wiedzę o projektowaniu promptów, ale brakuje im "wyczucia" — nie wiedzą co ma znaczenie w danej sytuacji. Twoja ocena jest niezbędna.

## Optymalizacja szybkości i skuteczności narzędzi

Każda akcja agenta = kolejne zapytanie do LLM + czas reakcji zewnętrznych usług. Główne dźwignie:

| Technika | Efekt | Jak |
|----------|-------|-----|
| **Prompt cache** | Priorytet — zmniejsza TTFT (Time to First Token), redukuje koszt | Nie zmieniaj instrukcji systemowej między zapytaniami; dynamiczne dane przez narzędzia, nie przez system prompt |
| **Ograniczenie błędów** | Mniej zapytań do LLM | Dobre projektowanie narzędzi ([[projektowanie-narzedzi]]) |
| **Łączenie akcji** | Mniej kroków | np. `workspace_metadata` zamiast 3 oddzielnych zapytań |
| **Parallel function calling** | Równoległe akcje niezależne | Większość providerów wspiera; projektuj narzędzia batch (edycja wielu rekordów naraz) |
| **Zmiana modelu** | Szybszy czas dla prostych zadań | Mniejszy model tam gdzie nie potrzebujesz flagship |
| **Ograniczenie kontekstu** | Krótszy czas reakcji (gdy cache niedostępny) | Minimum niezbędnych informacji w każdej turze |
| **Ograniczenia wypowiedzi** | Mniej generowanych tokenów | Przekazuj dane między narzędziami przez pliki, nie przez kontekst |

**Przykład optymalizacji przez pliki:**
- ❌ Narzędzie A generuje raport → model wczytuje raport → narzędzie B wysyła go mailem (raport generowany 2× w kontekście)
- ✅ Narzędzie A zapisuje raport do pliku → narzędzie B dołącza plik jako załącznik (raport generowany 1× — ok. 50% szybciej)

## Kompozycja promptu przyjazna cache (s02e01 harness)

Kolejność bajtów w renderowanym prompcie ma bezpośredni wpływ na koszt ekonomiczny. Wzorzec z [[s02e01-categorize-harness]]:

```
[static prefix]
[dynamic item suffix — id + description]
```

Prefix statyczny — **na początku**. Item dynamiczny — **na końcu**. Efekt: w pętli 10 callów 9 z 10 uderza w cache upstream modelu → koszt inputu spada o połowę (cached: 0.01 PP/10 tokenów, bez cache: 0.02 PP/10 tokenów).

Pesymistyczny bufor: zakładaj ~12 tokenów "świeżości" na dynamiczny suffix w pre-flight budget check (empiryczna stała). Jeśli suffix rośnie, bufor pozostaje bezpieczny (zawyżona estymacja), ale nie bardziej niż konieczne.

**Reguła:** w każdej pętli weryfikacji z zewnętrznym graderem, stable część promptu idzie jako prefix (cached), zmienna część per-item na końcu.

## Filtrowanie sygnału przed wysłaniem do LLM (s02e01 harness)

Zanim wyślesz feedback o błędach do LLM engineer/refiner — przefiltruj go do minimalnego informatywnego digestu. Wzorzec z [[s02e01-categorize-harness]]:

**Dropuj:**
- Surowe JSONy odpowiedzi zewnętrznego serwisu
- Pola debugowe i metryki niezwiązane z błędem
- Historię pól które się nie zmieniły

**Zachowaj:**
- Które itemy zostały odrzucone i z jakiego powodu (krótki label: "hub rejected", "parse error", "reactor miss")
- Worst-case token footprint: `prefix=N + newline=1 + suffix≈M = T/100`
- Dyrektywa budżetowa (jeśli błąd był budget-related → dodaj ograniczenie)

Ekonomiczny powód: każdy zbędny token w user message do LLM engineer kosztuje przy **każdej** kolejnej turze refinementu (historia rośnie liniowo). Przy 8 iteracjach różnica między surowym JSON a digestem może być 5–10× koszt tokenów engineera.

> Filtruj w kodzie, przekazuj agentowi tylko czystą esencję błędów — nie surowe odpowiedzi serwisów.

## Zarządzanie oknem kontekstowym

**Problem:** historia konwersacji rośnie → limit okna kontekstowego.

**Ewolucja podejść:**
1. ~~Pływające okno~~ — usuwanie najstarszych wiadomości. Nisczy cache, traci informacje.
2. **Auto-compact** (Claude Code, Cursor) — podsumowanie wątku gdy zbliżamy się do limitu. Kompresja = utrata części informacji.
3. **System plików jako rozszerzenie kontekstu** — wyniki narzędzi zapisywane do plików; agent eksploruje je gdy potrzeba zamiast wczytywać wszystko naraz.

**Krytyczna zasada — prompt cache:**
> Dynamiczne dane w instrukcji systemowej (nawet sama data i godzina) mogą mieć **krytyczny wpływ** na wydajność całego systemu — natychmiast kasują cache. Zewnętrzny kontekst ładuj przez narzędzia (trafia do końca wątku, nie psuje cache).

## Dynamiczna struktura instrukcji systemowej

Instrukcje nie kończą się na wiadomości systemowej — dynamiczne dane można wstrzykiwać do wiadomości użytkownika zachowując wysoki cache hit.

**Dlaczego:** definicje narzędzi leżą **pod** instrukcją systemową w oknie kontekstu. Jakakolwiek zmiana system promptu kasuje cache narzędzi.

**Cursor / Claude Code pattern:**

```
[Statyczny system prompt]           ← nie zmienia się
[Definicje narzędzi]                ← cachowane
[Wiadomość użytkownika:]
  <environment>
    branch: main | file: src/app.ts | date: 2026-04-30
  </environment>
  <user_request>Refaktoruj tę funkcję</user_request>
```

Dane dynamiczne (gałąź Git, aktywny plik, kursor, czas) → wiadomość użytkownika. System prompt statyczny → wysoki cache hit strukturalnie.

**Attention management przez powtórzenia:** ważne instrukcje mogą być powtarzane w kolejnych turach (nie system prompcie) — celowy mechanizm zarządzania uwagą modelu, który podczas długiej konwersacji może "zapominać" wczesne fakty.

**Task lists i plan mode:** narzędzie "listy zadań" nie jest tylko dla użytkownika — to mechanizm uwagi. Agent musi odhaczyć punkt i przepisać pozostałe przy każdej iteracji → powtórzenie kluczowych celów w kontekście. Wymaga programistycznego wsparcia (bez kodu agent robi to dopiero na końcu lub w ogóle). Plan mode (znany z Claude Code / Cursor) to wersja tego wzorca z trybem planowania sygnalizowanym w wiadomości użytkownika.

### Context masking / prefilling

> [!deprecated] Deprecated w Anthropic API (2026)
> Technika opisana przez zespół Manus — uzupełnianie tokenów odpowiedzi modelu deterministycznym prefiksem, aby ograniczyć dostępne narzędzia bez modyfikacji instrukcji.
> Przykład: `<|im_start|>assistant<tool_call>{"name": "browser_` → wymuszało korzystanie wyłącznie z narzędzi przeglądarki podczas sesji browserowej. Zdejmowane po zakończeniu sesji.
> Oznaczone jako [deprecated](https://platform.claude.com/docs/en/build-with-claude/working-with-messages) w Anthropic API. Historyczny przykład eksplorowania nowych podejść do sterowania zachowaniem agenta.

## 4 tryby nawigacji po zewnętrznych treściach (s02e03)

Dynamiczne ujawnianie kontekstu opiera się nie na strukturze katalogów, ale na **powiązaniach zawartych w treści dokumentów**. Naturalnie wystepuje w kodzie źródłowym (importy), Wikipedii (linkowanie wewnętrzne) i Second Brain (Obsidian, Roam, Logseq). W typowych treściach biznesowych — rzadko.

| Tryb | Opis | Jak |
|------|------|-----|
| **Perspektywa** | Spojrzenie "z lotu ptaka" | `ls`, katalog, `_index.md`, mapa zasobów |
| **Nawigacja** | Przeszukiwanie nazw plików i treści | `grep`, `ripgrep`, semantic search |
| **Powiązania** | Podążanie za odnośnikami | Importy w kodzie, wikilinki, wzmianka "szczegóły w pliku X" |
| **Szczegóły** | Czytanie oryginalnej treści | `read_file`, `cat` |

**Zasada (cytat z kursu):** sposób prezentowania zewnętrznych treści modelowi zwykle będzie **dynamiczny**, a ujawnianie kolejnych informacji będzie wynikało z **powiązań między dokumentami** zawartych w ich treści. Struktura katalogów jako mapa sprawdza się tylko gdy **struktura jest stała** i agent skupia się wyłącznie na jej interakcji.

Szerzej: [[knowledge-base-dla-agentow]] — KB budowana dla agentów vs podłączana.

## Dynamiczne listy narzędzi

**Problem:** agent z 30 narzędziami = 30 schematów w kontekście przy każdym zapytaniu → degradacja uwagi modelu + zużycie kontekstu.

**Cel:** ≤10–15 narzędzi per agent.

**Podejście Anthropic:** dynamiczne wczytywanie narzędzi bez wpływu na prompt cache — dostępne tylko u Anthropic. Dokumentacja: https://www.anthropic.com/engineering/advanced-tool-use

**Inne podejścia:**

| Technika | Jak działa |
|----------|-----------|
| **Sub-agenci** | Każdy agent = osobny zestaw narzędzi w osobnym oknie kontekstowym. Komunikacja przez pliki lub dedykowany protokół |
| **Progressive Disclosure** | Podstawowe narzędzia zawsze dostępne + narzędzie `code_execution`; pozostałe narzędzia jako pliki/katalogi, agent uruchamia je przez kod. Minimalne zużycie kontekstu na start |

**Problem pochodny:** agent "nie wie, że coś wie" — nie zna swojego zakresu możliwości. Zawsze zapewniaj mu przynajmniej podstawowe wskazówki o dostępnych zasobach lub mechanizm ich odkrywania.

## Instruction dropout przy długim kontekście (s02e02)

Zewnętrzne treści wczytywane przez narzędzia mogą wypychać instrukcje systemowe z "uwagi" modelu.

> Kurs: _"Agent może «zapomnieć» (bądź zignorować) część instrukcji systemowych, ponieważ zbyt duża część jego «uwagi» będzie skupiona na nowo dodanych treściach."_

Badania: "[How Many Instructions LLMs Follow at Once](https://arxiv.org/pdf/2507.11538)", "[Reasoning on Multiple Needles In A Haystack](https://arxiv.org/pdf/2504.04150v1)".

**Mitigacja:** powtarzaj kluczowe instrukcje w kolejnych wiadomościach (nie system prompt) — to celowy mechanizm zarządzania uwagą, już opisany wyżej w sekcji "Dynamiczna struktura". Zewnętrzne treści ładuj przez narzędzia, a nie przez system prompt.

## Globalny kontekst w systemach wieloagentowych (s02e04)

Gdy agentów jest więcej niż jeden (lub jeden szablon agenta uruchomiony wielokrotnie) — kontekst współdzielony staje się **stanem produkcyjnym** z race conditions, degradacją i własną interpretacją. Sześć wyzwań z lekcji s02e04:

| # | Wyzwanie | Szybka mitigacja |
|---|---------|------------------|
| 1 | **Sesja vs pamięć** — co utrwalać, kto decyduje | Dla agentów w tle: zgeneralizowane założenia + walidacja w kodzie (nie w prompcie) |
| 2 | **Degradacja komunikacji** — info gubi się przy delegowaniu | Starannie napisane instrukcje `delegate`/`message`; redundancja kluczowych danych |
| 3 | **Własna interpretacja** | Otwarte zadania → rozpisuj na konkretne podpunkty zanim oddasz subagentowi |
| 4 | **Kontekst informacji** — Anna_1 vs Anna_2 | Identyfikatory zamiast imion + metadane (kiedy, w jakim wątku, w odniesieniu do czego) |
| 5 | **Duplikowanie informacji** | Okresowy skan duplikatów tanim modelem; `merge_entities` w bazach grafowych |
| 6 | **Metadane** — źródło, data, autor | Wymagaj minimum trzech pól per wpis: `source`, `created`, `session_id` |

**Zasada projektowa:** zewnętrzny kontekst opisuje **co wiemy**, a nie **co robić**. Logika („co i kiedy") należy do systemu, nie do dokumentów. Inaczej zmiana zachowania wymaga edycji pamięci, a zmiana faktów modyfikuje pętlę agenta.

→ Pełna analiza: [[globalny-kontekst-konflikty]]; rola koordynatora: [[agent-manager]].

## Sześć kategorii wiedzy w systemach wieloagentowych (s02e05)

Wiedza dostępna w systemie wieloagentowym dzieli się na sześć kategorii o różnych zakresach dostępności i sposobach zarządzania:

| Kategoria | Dostępność | Kto zarządza | Przykład |
|-----------|-----------|-------------|---------|
| **Session documents** | Bieżąca sesja; wszyscy zaangażowani agenci | Kod (automatycznie) | Załączniki użytkownika, pliki wygenerowane przez agentów |
| **Public knowledge** | Współdzielona: agenci + użytkownicy systemu | Wymagana klasyfikacja | Baza wiedzy firmowej, dokumentacja produktów |
| **Private knowledge** | Dedykowana konkretnemu użytkownikowi | Wymagana klasyfikacja | Kontekst osobisty, zasoby, procesy per-user |
| **Agent knowledge** | Per-agent | Agent lub Memory Manager | Instrukcje narzędzi, wspomnienia, wnioski, obserwacje |
| **Cache** | Tymczasowa; cross-session lub lokalna (sandbox) | Kod (TTL, scope) | Wyniki wyszukiwania, treści stron www |
| **Runtime** | Niewidoczna dla agentów | Kod | Sesje, harmonogram zadań, zarządzanie interakcją |

**Kluczowe wyzwanie:** kategorie nie są wzajemnie rozłączne. Informacja o nowym projekcie może być `private` albo `public`. Instrukcja wykonania zadania może trafić w kategorię `private`, `public` lub `agent`. Informacja o profilu osoby może wystąpić w kilku kategoriach jednocześnie.

Praktyczna zasada: **proste struktury > złożone reguły klasyfikacji**. Przy niejednoznaczności kategorie nie eliminują potrzeby decyzji — jedynie ją ramują. Zadaj pytanie: czy zaawansowana pamięć długoterminowa jest tu faktycznie potrzebna, czy wystarczą proste dokumenty?

**Różnica wobec "4 warstw systemu promptu" z s02e01:** tamte warstwy opisują co trafia do instrukcji systemowej w momencie wywołania agenta (universal / environment / session / multi-agent). Te sześć kategorii opisuje gdzie dane żyją w systemie długoterminowo — to ortogonalna klasyfikacja.

## Estymacja tokenów i progi kompresji (s01e05)

Na produkcji liczba tokenów w kontekście musi być kontrolowana aktywnie.

**Wstępna estymacja przed wysłaniem zapytania:**
- Reguła: `chars / 4` (1 token ≈ 3-4 litery w języku angielskim)
- Dodaj bufor: ~20% limitu danego modelu
- Po odpowiedzi API: uzupełnij estymację rzeczywistymi wartościami z odpowiedzi (`usage.input_tokens`, `usage.output_tokens`)

**Kiedy uruchomić kompresję kontekstu:**
- Pierwsze akcje kompresji: przy ~30% zużycia dostępnego limitu (bardzo wcześnie — lepiej za wcześnie niż za późno)
- Dostępne techniki: kompresja, przesłanianie (summary), ekstrakcja kluczowych informacji

**Limit tokenów wyjściowych ≠ rozmiar okna:**
- `max_tokens` to oddzielny parametr; aktualne limity: 2 000–128 000 tokenów output
- Przykład: model z oknem 400k i `max_tokens=128k` → tylko 272k tokenów na wejście
- Szczegóły: [[api-providerzy]]

## Powiązania z s01e01

- [[few-shot-i-kontekst]] — kontekst jako narzędzie sterowania zachowaniem → to samo kryje się za dynamicznym zarządzaniem kontekstem agenta
- [[api-providerzy]] — prompt cache był już wymieniony jako jeden z najważniejszych mechanizmów dla agentów; s01e02 rozszerza dlaczego; s01e05 dodaje estymację i limity output
- [[rendering-i-streaming]] — semantyczne zdarzenia i auto-compact w Claude Code; s01e02 wyjaśnia mechanikę kompresji kontekstu od strony architektury

## Pytania sprawdzające

1. Dlaczego dynamiczne dane w instrukcji systemowej (np. aktualna data) są problematyczne? Jak to naprawić?
2. Co to jest "mapa treści" (`_index.md`) i jaki problem z transformacją zapytań rozwiązuje?
3. Dlaczego przekazywanie dużych treści między narzędziami przez pliki jest szybsze niż przez kontekst konwersacji?
4. Czym różni się pływające okno kontekstu od auto-compact — i dlaczego auto-compact jest lepszy?
5. Co to jest Progressive Disclosure w kontekście narzędzi agenta?
6. Jak "uśrednianie" przez wiele modeli LLM pomaga w jakości reasoning?
7. Jak szacować liczbę tokenów przed wysłaniem zapytania — i przy jakim progu uruchomić kompresję?
8. Jakie są 4 warstwy kontekstu w instrukcji systemowej agenta i co każda z nich zawiera?
9. Dlaczego zmiana system promptu kasuje cache narzędzi — i jak to obejść zachowując dynamiczne dane?
10. Jaka jest pułapka przy generowaniu instrukcji systemowych z LLM — i jak ją ominąć?
11. Co to jest Agentic RAG i czym różni się od statycznego RAG?
12. Jakie są 4 generyczne strategie wyszukiwania w Agentic RAG i po co każda?
13. Co to jest context masking / prefilling i dlaczego jest deprecated w Anthropic API?
14. Dlaczego task list to narzędzie uwagi, a nie tylko narzędzie dla użytkownika — i dlaczego wymaga programistycznego wsparcia?

## Powiązane strony

- [[agentic-rag]] — Agentic RAG: 4 strategie, mechanika, anti-patterns
- [[function-calling]] — narzędzia generują wyniki w kontekście
- [[projektowanie-narzedzi]] — optymalizacja narzędzi pod kątem kontekstu
- [[workflow-i-agenci]] — Agent Harness i zarządzanie kontekstem, workspace agentów
- [[api-providerzy]] — prompt cache, limity tokenów, output tokens vs context window
- [[produkcyjne-ai]] — estymacja tokenów jako element produkcyjnego zarządzania kosztami
- [[s01e02]] — pełna lekcja (podstawy context engineering)
- [[s02e04]] — globalny kontekst, sesja vs pamięć, degradacja komunikacji
- [[globalny-kontekst-konflikty]] — race conditions, 5 strategii, 6 wyzwań współdzielenia
- [[agent-manager]] — manager z minimalnym zestawem narzędzi
- [[s01e05]] — estymacja tokenów, progi kompresji, limity API
- [[s02e01]] — deep-dive: 4 warstwy context, agentic RAG, dynamiczna instrukcja, workspace
- [[s02e02]] — instruction dropout, zewnętrzny kontekst jako wektor ataku
- [[s02e03]] — 4 tryby nawigacji po treściach, KB dla agentów, Observational Memory
- [[knowledge-base-dla-agentow]] — KB tworzona dla agentów: 4 tryby nawigacji, multi-agent pipeline
- [[observational-memory]] — kompresja zamiast retrieval: Observer/Reflector
- [[s02e01-categorize-harness]] — cache-friendly composition, signal-vs-noise filtering, budget-bounded loop

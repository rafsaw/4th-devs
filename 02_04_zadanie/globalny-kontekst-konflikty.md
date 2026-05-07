---
created: 2026-05-05
updated: 2026-05-05
last-confirmed: 2026-05-05
type: concept
confidence: medium
tags: [topic/agents, topic/context, topic/multi-agent, topic/memory]
sources:
  - "[[raw/AI-Devs-4_s02e04/AI-Devs-4_s02e04_02!Rola_globalnego_kontekstu_i_jego_zawartosc]]"
  - "[[raw/AI-Devs-4_s02e04/AI-Devs-4_s02e04_03!Wspoldzielenie_kontekstu]]"
---

# Globalny kontekst i konflikty w systemach wieloagentowych

Globalny kontekst (pamięć, baza wiedzy, współdzielone notatki) w systemie wieloagentowym to **ten sam mechanizm**, co kontekst współdzielony między sesjami z [[s02e01]], **ale jego treść kształtuje również sposób interakcji między agentami**. Najważniejsza różnica: agenci mogą pracować na tych samych treściach **jednocześnie**.

> [!moja-notatka]
> Problem konfliktów to nie tylko kwestia „wielu agentów". Wystarczy **jeden agent uruchomiony wielokrotnie**, żeby zacząć mówić o systemie wieloagentowym opartym na jednym szablonie. Dwa równoległe zapytania mogą doprowadzić do utraty informacji.

## Skąd biorą się konflikty

**Przykład z lekcji:** jeden agent w dwóch instancjach. Obie aktualizują tę samą notatkę pamięci długoterminowej. **Agent B zapisuje plik później** niż **Agent A** — zmiany A zostają nadpisane bez śladu.

To znany problem z programowania (race condition na wspólnym zasobie). Znamy też klasyczne rozwiązanie — **systemy kontroli wersji**. Ale praktyka pokazuje, że **nie da się go wprost przenieść** na agentów, bo:

- przy klasycznym merge'u **człowiek wie**, które zmiany powinny zostać zachowane i jak
- agentowi nierzadko **brakuje informacji**, by tę decyzję podjąć
- konflikt między dwoma agentami to konflikt między dwiema **interpretacjami**, nie tylko między dwiema wersjami tekstu

## Pięć strategii zarządzania konfliktami

Lekcja wymienia pięć podejść — w praktyce zwykle **kombinujemy kilka jednocześnie**.

### 1. Wykrywanie konfliktów

Agenci zwykle najpierw **czytają** treść, którą chcą zmodyfikować. Jeśli między odczytem a zapisem doszło do modyfikacji — wykrywamy to przez:

- **sumy kontrolne (checksum)** całego dokumentu
- **hash'e per linia** (lekcja linkuje do [tweeta @_can1357](https://x.com/_can1357/status/2021828033640911196))
- timestampy / version numbers

Pattern: `read → compute_hash → modify → atomic_write_if_hash_matches → on_mismatch_retry_or_escalate`.

### 2. Unikanie konfliktów

Część konfliktów eliminuje się **na poziomie założeń**, zanim w ogóle do nich dojdzie:

- przynależność zasobów (każdy agent ma własną przestrzeń)
- **uprawnienia** (większość agentów = read-only; tylko dedykowane mogą pisać)
- **izolacja na poziomie sesji** (zmiany agenta widoczne tylko w jego sesji do czasu commitu)
- shardowanie (różni agenci = różne obszary)

To często **najtańsze i najbardziej niezawodne** rozwiązanie — projektuj tak, żeby konflikt nie miał szansy powstać.

### 3. Agent zarządzający (memory manager)

Wybrane obszary zewnętrznego kontekstu (typowo **pamięć**) ma na wyłączność jeden agent. Pozostali komunikują się z nim przez `delegate` / `message`.

- ma dodatkowe uprawnienia (wgląd w historię interakcji)
- może mieć możliwość kontaktu z człowiekiem
- działa jak **single writer** — eliminuje wyścigi po stronie zapisu

→ Powiązane: [[agent-manager]] (wzorzec roli managera), [[observational-memory]] (Memory Manager jako koncept).

### 4. Historia zmian (append-only)

Niektóre rodzaje informacji można **przechowywać z pełną historią zmian**. Wtedy:

- rzadziej dochodzi do bezpośrednich konfliktów (każda zmiana to nowy wpis, nie nadpisanie)
- agent widzi, jak dane zmieniały się w czasie
- merge naturalnie staje się problemem **odczytu**, nie zapisu

Dokładnie ten wzorzec realizuje **Observational Memory** ([[observational-memory]]) — Observer dopisuje, Reflector kompresuje. Brak race condition na zapisie.

### 5. Zmiany manualne (human-in-the-loop)

Tam, gdzie automatyczne rozwiązania nie wystarczą — wciąga się **człowieka**, podobnie jak w klasycznym `git merge`. Z lekcji: dashboard zarządzania ([[agent-manager#Dashboard]]) jest właśnie tym miejscem.

## Kontekst zewnętrzny vs logika agentów

Lekcja stawia ważną zasadę architektoniczną:

> Dokumenty nie powinny mówić wprost **co agenci mają robić oraz kiedy** — to zadanie systemu. Zewnętrzny kontekst nie powinien być z nim zbyt mocno powiązany.

Implikacje:

- **bazy wiedzy / pamięć**: opisują *co wiemy*, nie *co robić*
- **logika agenta**: instrukcje systemowe, narzędzia, zasady — nie w pamięci
- granica jest miękka, ale jej rozmycie skutkuje tym, że zmiana zachowania wymaga zmian w pamięci, a zmiana faktów modyfikuje pętlę agenta

**Memory Manager** zarządza dokumentami, ale wskazane jest, żeby były one **dostępne także dla ludzi** — chodzi o:

- utrzymanie odpowiednich struktur
- realną **kolaborację** człowiek ↔ agent (nie tylko nadzór)

→ Powiązane: [[knowledge-base-dla-agentow]] (KB tworzona dla agentów vs istniejąca).

## Sześć wyzwań współdzielenia kontekstu

Lekcja wymienia sześć obszarów, na które trzeba zwrócić uwagę przy organizacji kontekstu i zasad posługiwania się nim. Dotyczą one zarówno agentów, jak i ludzi.

### 1. Sesja vs pamięć

Wydaje się oczywiste — sesja tymczasowa, pamięć długoterminowa. **To zbyt duże uproszczenie**: w sesji pojawiają się treści, które muszą zostać utrwalone, i ktoś musi o tym **decydować**.

- chatbot: relatywnie proste — system reaguje na polecenia użytkownika lub sam sugeruje zapis
- agent w tle: potrzebuje **więcej autonomii** + zgeneralizowanych założeń **balansowanych z wytycznymi weryfikowanymi w kodzie** (np. dostęp do katalogów)

### 2. Degradacja komunikacji

Przekazywanie informacji między agentami **gubi i zniekształca** dane. Problem szybko narasta wraz ze złożonością sesji i zadania.

Wnioski:
- instrukcje narzędzi `delegate` / `message` muszą być **starannie opracowane**
- system **musi zakładać**, że agent dostanie tylko **częściowe** informacje → potrzebna dodatkowa weryfikacja
- redundancja: kluczowe dane warto przekazywać przynajmniej dwukrotnie różnymi ścieżkami

### 3. Własna interpretacja

Nawet z kompletem informacji agent może je **zinterpretować po swojemu**.

- ryzyko **mniejsze** dla zadań oczywistych (`zaktualizuj dane klienta X`)
- ryzyko **większe** dla otwartych (`znajdź wszystkie informacje na temat klienta X`)

Pattern obronny: zadania otwarte rozpisuj parentem na **konkretne podpunkty** zanim oddasz subagentowi.

### 4. Kontekst informacji

Przy trwałym zapisie łatwo zgubić kontekst, który był jasny w rozmowie.

**Przykład z lekcji:** notatka o osobie „Anna" może zostać pomylona w innej rozmowie o kimś o tym samym imieniu.

Lekarstwa:
- **identyfikatory** zamiast imion (Anna_1234 zamiast Anna)
- metadane (kiedy, w jakim wątku, w odniesieniu do czego)
- jednoznaczne odwołania w treści

### 5. Duplikowanie informacji

Nawet przy dobrej architekturze ta sama wiedza ląduje w więcej niż jednym miejscu. Tego problemu **trudno uniknąć**, ale można na niego **reagować**:

- mniejsze (i tańsze) modele mogą **skanować dane modyfikowane w danym okresie** i wykrywać potencjalne duplikaty
- widzieliśmy to przy bazach grafowych: narzędzia `merge_entities` / `audit` ([[agentic-rag#Implementacja — przykład 02_01_agentic_rag]])

### 6. Metadane

W klasycznych aplikacjach każda informacja ma metadane (źródło, data utworzenia, autor). U agentów metadane są używane:

- **podczas komunikacji między agentami** (które dane są świeże, skąd pochodzą)
- **w komunikacji z użytkownikiem** (np. „o czym rozmawialiśmy podczas drogi do Warszawy" — bez metadanych miejsca/czasu nie odpowiesz)

> [!moja-notatka]
> Te sześć wyzwań brzmi oczywisto — i takie jest, dopóki nie zaczniesz budować. Wtedy ujawniają się **na produkcji**, najczęściej w postaci „dlaczego ten agent nie wziął pod uwagę X, skoro X jest w pamięci?". Odpowiedź zwykle ląduje w jednym z tych sześciu pól.

## Zasada projektowa

Lekcja kończy mocną sugestią:

> Zaprojektuj system **tak prosty, jak to możliwe**, i utrzymuj go w tej formie **jak najdłużej**. Systemy wieloagentowe nie muszą od razu przejmować kontroli nad organizacją. Jeden system może obsługiwać wiele niezależnych obszarów przy bardzo ograniczonej wymianie informacji między agentami.

To powtórzenie zasady „less is more" z [[CLAUDE]] / persony, ale w kontekście kontekstu globalnego — **im więcej współdzielenia, tym więcej konfliktów i degradacji**.

---

## 🏗️ Architecture Thinking

- **Rola w systemie**: storage / state — globalny kontekst to warstwa stanu poza sesjami agentów; tu rozstrzyga się, co jest „prawdą systemu".
- **Core vs supporting**: core dla każdego systemu wieloagentowego; bez świadomego designu kontekstu globalnego system zaczyna się zachowywać niedeterministycznie po pierwszych równoległych zapisach.
- **Dependencies**:
  - storage z atomic writes (DB, plik z lock-iem, append-only log)
  - hash/timestamp/version dla detekcji konfliktów
  - dedykowany agent (Memory Manager) lub event bus dla single-writer pattern
  - dashboard / human-in-the-loop dla rozwiązywania pat-sytuacji
- **Trade-offs**:
  - **append-only history** vs storage cost: pełna historia eliminuje konflikty zapisu, ale rośnie nieskończenie
  - **single writer agent** vs latency: serializacja zapisów eliminuje race conditions, ale wprowadza wąskie gardło
  - **read-only dla większości** vs ekspresywność: bezpieczne, ale część agentów potrzebuje stanu mutowalnego per-session

---

## 🏢 Use Case Mapping (GENERIC)

**Typ problemu:**
- shared-state management
- memory architecture for agents

**Gdzie pasuje:** storage / processing layer; każdy system wieloagentowy z trwałą pamięcią lub współdzielonymi dokumentami.

**Kiedy używać (świadomego designu konfliktów):**
- co najmniej dwóch pisarzy do wspólnego zasobu (w tym ten sam agent w wielu instancjach)
- pamięć długoterminowa współdzielona między sesjami
- baza wiedzy aktualizowana przez wielu aktorów (agenci + ludzie)

**Kiedy NIE komplikować:**
- pojedynczy agent, jedna sesja, brak współdzielenia
- każdy agent ma własną przestrzeń (shardowanie wystarczy)
- dane są read-only z perspektywy agentów

---

## ❌ Anti-patterns / risks

- **Last-writer-wins bez świadomości**: domyślny FS / DB nadpisuje cicho — utrata danych nie zostawia śladu.
- **Mocno powiązany kontekst i logika**: dokumenty mówiące „kiedy zrobić X" zamiast „X jest faktem". Każda zmiana zachowania wymaga zmian w pamięci.
- **Manager Agent jako bottleneck na wszystko**: jeden manager pisze całą pamięć → szybko się dusi. Shardujemy domeny pamięci między managerów.
- **Pełna autonomia bez paneli**: lekcja wprost: „nadal człowiek pełni rolę kluczowego koordynatora" — pomijanie dashboardu = pomijanie ostatniej linii obrony.
- **Brak metadanych**: notatki bez `source` / `created` / `session_id` → niemożliwe do dezambiguacji (case Anna).
- **Próba przeniesienia git mergetool 1:1**: agent z brakiem informacji nie rozwiąże konfliktu sensownie. Konflikty albo unikamy, albo eskalujemy do człowieka.
- **Duplikaty bez audytu**: brak okresowego skanu duplikatów → wiedza rozpływa się po systemie i agenci znajdują różne wersje tego samego.

---

## 🧪 Experiment / What to test

**Cel:** wywołać i zaobserwować realny race condition w pamięci agenta, przetestować dwie strategie obronne.

**Setup:**
- jeden agent szablon, instrukcja: „przeczytaj `notes.md`, dodaj fakt o użytkowniku, zapisz"
- uruchomić **dwie instancje równolegle** z różnymi faktami
- wariant A: brak ochrony — sprawdzić, czy gubi się jeden zapis
- wariant B: hash-check przed zapisem; on_mismatch — re-read + retry
- wariant C: append-only log + Reflector kompresujący raz na N wpisów ([[observational-memory]] pattern)

**Co zmierzyć:**
- ile zapisów ginie w wariancie A (na 100 par równoległych zapisów)
- ile retry potrzeba w wariancie B (rozkład)
- jaki jest narzut storage w wariancie C po 1000 wpisów

**Czego się spodziewać:**
- A zgubi ok. 50% drugich zapisów (random scheduling)
- B działa, ale przy 5+ równoległych pisarzach retry zaczynają lawinować
- C najtańszy w pisaniu, najdroższy w czytaniu (Reflector + retrieval) — ale najodporniejszy

---

## 🔗 Powiązania

- [[multi-agent-architectures]] — gdzie konflikty się ujawniają
- [[agent-manager]] — Memory Manager jako single writer
- [[observational-memory]] — append-only history jako natural conflict avoidance
- [[knowledge-base-dla-agentow]] — KB dla agentów (struktury), z którymi agenci pracują
- [[context-engineering]] — sesja vs pamięć, kontekst współdzielony
- [[bezpieczenstwo-agentow]] — uprawnienia per-agent / per-user dla zewnętrznego kontekstu
- [[agentic-rag]] — `merge_entities` / `audit` jako narzędzia do duplikatów
- [[s02e04]]

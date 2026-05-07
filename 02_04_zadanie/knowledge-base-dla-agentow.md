---
created: 2026-04-30
updated: 2026-04-30
last-confirmed: 2026-04-30
type: concept
confidence: high
tags: [course/ai-dev4, topic/knowledge-base, topic/agents, topic/rag, topic/context]
sources:
  - "[[raw/AI-Devs-4_s02e03/AI-Devs-4_s02e03_02!Kategoryzacja_oraz_mapa_obszarow_bazy_wiedzy]]"
  - "[[raw/AI-Devs-4_s02e03/AI-Devs-4_s02e03_03!Prezentowanie_dostepnych_zasobow_dla_modelu]]"
  - "[[raw/AI-Devs-4_s02e03/AI-Devs-4_s02e03_04!Rola_bazy_wiedzy_w_interakcji_z_otoczeniem]]"
---

# Baza wiedzy dla agentów

Paradygmat projektowania bazy wiedzy **z myślą o agentach AI** — zamiast podłączać agenta do istniejących dokumentów pisanych dla ludzi, tworzyć dokumenty tak, by agent wiedział gdzie patrzeć. Źródło: [[s02e03]] · rozdziały _02, _03, _04.

**Kluczowe rozróżnienie (cytat z kursu):**
> W pierwszym przypadku agent **ma szansę** trafić na właściwe dokumenty. W drugiej wprost wie, gdzie się one znajdują.

## Dwa tryby podłączania bazy wiedzy

| Tryb | Opis | Problem |
|------|------|---------|
| **Istniejąca KB** | Dokumenty pisane dla ludzi (manuale, wiki firmowe, transkrypcje) | Agent musi szukać — dokumenty rzadko mają powiązania; kontekst może być rozproszony między wieloma plikami |
| **KB budowana dla agentów** | Dokumenty projektowane pod kąt nawigacji agenta; struktura katalogów + odnośniki między plikami | Agent nie szuka — podąża za wskazówkami zawartymi w treści |

## Jak agent porusza się po KB "dla agentów"

Nie chodzi o specyficzne instrukcje ("proces X opisany w pliku Y"), tylko **generyczne wskazówki**:

> "Instrukcje obsługi Twoich narzędzi znajdziesz w `./workflows`"

Agent Task Manager, przykład z kursu:
```
1. Prośba: "dodaj zadanie do projektu"
2. Agent czyta ./workflows/task-management.md
3. Trafia na wzmiankę o ./projects/overview.md
4. Czyta projects/overview.md → identyfikuje właściwy projekt
5. Dodaje zadanie do Linear z prawidłowym projektem
```

## 4 tryby nawigacji po treściach

Kod źródłowy to naturalny przykład KB "dla agentów" — importy tworzą mapę powiązań. Ten wzorzec można przenieść na dowolną KB:

| Tryb | Co robi | Przykład |
|------|---------|---------|
| **Perspektywa** | Spojrzenie "z lotu ptaka" na dostępne materiały | `ls ./workflows`, katalog, index |
| **Nawigacja** | Przeszukiwanie nazw plików i ich treści | `grep`, `ripgrep`, wyszukiwanie po słowie kluczowym |
| **Powiązania** | Podążanie za odnośnikami między plikami | Import chains w kodzie, wikilinki, wzmianka "więcej w pliku X" |
| **Szczegóły** | Czytanie oryginalnej treści dokumentu | `cat`, `read_file` |

> To zjawisko (ekspozycja kontekstu przez zawartość dokumentu) naturalnie występuje w kodzie i nielicznych typach treści pisanych dla ludzi: Wikipedia (bogate linkowanie wewnętrzne), Second Brain / Digital Garden (Obsidian, Roam, Logseq). W treściach biznesowych (dokumentacje, maile, dokumenty finansowe) — rzadko albo wcale.

## Łączenie ze źródłem vs nauka ze źródła

| Podejście | Jak widzą to chunks | Problem |
|-----------|---------------------|---------|
| **Łączenie ze źródłem** (klasyczny RAG) | Kontekst przez chunki — pozbawiony powiązań | Agent nie wie co łączy fragmenty; kontekst bez struktury nawigacyjnej |
| **Nauka ze źródła** (KB dla agentów) | Dane prezentowane tak, by agent mógł po nich nawigować | Wymaga zaprojektowania dokumentów z myślą o agencie |

**Uwaga:** "nauka ze źródła" nie oznacza, że agent magicznie zapamiętuje wszystko — dynamiczne budowanie pamięci to nadal otwarty problem. Chodzi o **organizację** treści, nie o zakodowanie jej w parametrach modelu.

## Multi-agent pipeline przez wspólną KB

Wiele agentów działających w osobnych sesjach może współdzielić wiedzę przez **wspólną strukturę katalogów**. Przykład newsletter pipeline:

```
Researcher (sesja 1): blogi → newsletter/edition-26/blog-posts.md
Researcher (sesja 2): YouTube → newsletter/edition-26/youtube-clips.md
Researcher (sesja 3): newslettery → newsletter/edition-26/newsletters.md

Writer (sesja 4): newsletter/edition-26/ + daily-newsletter.md → content.md
Sender (sesja 5): newsletter/edition-26/content.md → szkic kampanii
```

**Zalety dekompozycji na sesje:**
- Każdy agent skupiony wyłącznie na wybranym zadaniu → wysoka jakość
- Optymalizacja kosztów: płacisz za wielokrotne wczytanie instrukcji, nie za jeden długi kontekst
- Łatwe debugowanie: każda sesja audytowalna osobno

## Kompozycja informacji — skalowalność

Gdy pojawi się nowa kategoria zadań w procesie, wystarczy zaktualizować **jeden wpis** — reszta procesu dostosowuje się samodzielnie. Wymaga jednak dyscypliny:

> Nikt nie powiedział, że agenci AI od razu mają przejmować kompletne procesy, a nie ich pojedyncze elementy — gdzie nadal mogą wnosić ogromną wartość.

## Skalowanie i limity

- Podejście sprawdza się dobrze dla **dobrze zdefiniowanych procesów**
- Przy bardzo złożonych procesach i bogatych interakcjach z ludźmi ujawniają się wyzwania
- Nie jest to rozwiązanie zastępujące semantic search przy istniejących dokumentach ludzkich

## 🏗️ Architecture Thinking

- **Rola w systemie:** orchestration — decyduje o architekturze dostępu do wiedzy dla całego systemu agentów
- **Core vs supporting:** core jeśli projektujesz system od zera; mniej relevantny gdy podłączasz agenta do legacy dokumentacji
- **Dependencies:** filesystem lub odpowiednie storage, konwencje nazewnictwa, dyscyplina utrzymania struktury
- **Trade-offy:**
  - KB dla agentów: niska złożoność retrieval, pełna kontrola → wymaga utrzymania; nie działa dla ad-hoc dokumentów
  - Istniejąca KB + RAG: działa z istniejącymi dokumentami → niższy recall, wyższy koszt wyszukiwania

## 🏢 Use Case Mapping (GENERIC)

**Typ problemu:** RAG + agent — dostęp do wiedzy w systemach agentowych

**Gdzie pasuje:**
- Agenci obsługujący dobrze zdefiniowane procesy (zarządzanie zadaniami, generowanie raportów, onboarding)
- Multi-agent pipelines z wspólną bazą danych
- Nowe systemy pisane od zera — nie legacy integracje

**Kiedy używać:**
- Projektujesz procesy specjalnie dla agentów
- Baza wiedzy rośnie wraz z projektem i możesz ją kontrolować

**Kiedy NIE:**
- Masz gotowy corpus dokumentów ludzkich (wiki firmowa, maile, raporty) → użyj RAG
- Agent musi odpowiadać na nieprzewidywalne zapytania z szerokiego zakresu → potrzebujesz retrieval

## ❌ Anti-patterns / risks

- **Specyficzne instrukcje w system prompcie** ("gdy zapytasz o X, sprawdź Y") — naprawia jeden przypadek, kruche przy zmianach struktury
- **Brak kompozycyjności** — dokumenty standalone bez odnośników → agent traci połączenia między nimi
- **Brak dyscypliny utrzymania** — nieaktualne instrukcje w `workflows/` = błędy agenta
- **Zmiana struktury bez aktualizacji odnośników** — powiązania zrywają się w całym systemie

## 🧪 Experiment / What to test

**Test: nawigacja przez powiązania vs semantic search**
- Setup: ta sama KB w dwóch wersjach: (a) dokumenty z wewnętrznymi odnośnikami, (b) te same dokumenty bez odnośników
- Sprawdź: czy agent z powiązaniami trafia do właściwego kontekstu w mniej krokach niż agent z semantic search
- Spodziewane: KB z powiązaniami lepsza dla procesów "step-by-step"; semantic lepsza dla ad-hoc

## Powiązane strony

- [[agentic-rag]] — strategie wyszukiwania przez agenta (gdy KB nie jest "dla agentów")
- [[context-engineering]] — dynamiczna ekspozycja kontekstu, 4 warstwy instrukcji
- [[rag-indeksowanie-i-retrieval]] — pipeline indeksowania gdy KB jest "dla ludzi"
- [[workflow-i-agenci]] — multi-agent coordination, workspace agentów
- [[s02e03]] — pełna lekcja

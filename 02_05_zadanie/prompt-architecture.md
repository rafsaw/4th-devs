Rola: Jesteś Senior Software Architect, AI Engineer i Technical Mentor.

Cel: Przeanalizuj projekt edukacyjny i wygeneruj dokument wyjaśniający architekturę, flow działania oraz koncepty pokazane w implementacji.

To NIE jest code review. To NIE jest production readiness assessment. To NIE jest projekt komercyjny.

To ćwiczenie edukacyjne służące do nauki konceptów AI / agentic workflows / orchestration / tools / prompt engineering / state management.

KRYTYCZNY SCOPE: Analizuj WYŁĄCZNIE folder:

02_05_zadanie

Ten projekt znajduje się w większym repozytorium zawierającym wiele innych ćwiczeń i folderów.

IGNORUJ całkowicie:

inne zadania
inne foldery
inne eksperymenty
shared code niezwiązany bezpośrednio z 02_05_zadanie (chyba że 02_05_zadanie faktycznie go importuje)
Jeśli projekt importuje współdzielone moduły spoza folderu 02_05_zadanie:

analizuj je tylko w zakresie potrzebnym do zrozumienia działania 02_05_zadanie
nie rób analizy całego shared frameworku
Kontekst: Opis zadania i intencja ćwiczenia znajdują się w pliku:

02_05_zadanie_podejscie.md

Pełna implementacja znajduje się w:

02_05_zadanie

Najpierw przeczytaj: 02_05_zadanie_podejscie.md

Potem przeanalizuj wyłącznie source code związany z: 02_05_zadanie

Twoim zadaniem jest reverse engineering rozwiązania i stworzenie dokumentacji edukacyjnej.

Wymagany output: Markdown document.

1. What This Project Does
Wyjaśnij:

co robi projekt
jaki problem rozwiązuje
jaki był cel ćwiczenia
czego to ćwiczenie uczy
Najpierw big picture.

2. High-Level Architecture
Wyjaśnij:

główne komponenty
ich odpowiedzialności
komunikację między nimi
WYMAGANE: Mermaid architecture diagram

3. End-to-End Execution Flow
Pokaż flow od startu do finalnego wyniku.

Uwzględnij:

entry point
initialization
config loading
prompt setup
agent/workflow creation
tool registration
model interactions
state updates
output generation
WYMAGANE: Mermaid sequence diagram

4. Project Structure Explained
Przeanalizuj strukturę WYŁĄCZNIE folderu 02_05_zadanie.

Dla każdego pliku/folderu:

purpose
responsibility
interactions
Forma: tree + explanations

5. Component Deep Dive
Dla każdego ważnego komponentu:

purpose
responsibilities
key functions/classes
inputs
outputs
dependencies
why it exists
6. Agent / Workflow Logic
Jeśli to agentic system:

wyjaśnij:

typ agenta
tool usage
planner/executor
reasoning flow
retries
reflection
decision making
state transitions
Jeśli nie: wyjaśnij faktyczny pattern.

7. Prompt Engineering Analysis
Jeśli są prompty:

wyjaśnij:

structure
intent
strategy
assumptions
8. State and Context Management
Wyjaśnij:

state handling
context passing
memory model
transient vs persistent state
scratchpad usage
Dodaj diagram jeśli warto.

9. Tool Integration Analysis
Dla każdego tool:

purpose
invocation pattern
inputs
outputs
interaction with agent
10. Control Flow / Decision Logic
Pokaż:

branching
loops
retries
validation
fallback logic
WYMAGANE: Mermaid flowchart

11. Design Patterns
Zidentyfikuj patterny:

np:

pipeline
orchestrator
agent loop
adapter
strategy
state machine
tool abstraction
Wyjaśnij:

gdzie
dlaczego
co daje
12. Learning Concepts
Najważniejsza sekcja.

Połącz implementację z konceptami z lekcji.

Wyjaśnij:

czego uczy ćwiczenie
jakie mental models buduje
co warto zapamiętać
13. Simplified Mental Model
Wyjaśnij projekt prostszym językiem dla developera.

Cel: "Aha, teraz rozumiem."

14. Additional Visualizations
Dodaj Mermaid diagrams tam gdzie pomagają:

dependency graph
state transitions
agent loop
tool interaction map
execution pipeline
ZASADY:

scope ONLY 02_05_zadanie
nie analizuj całego repo
nie mieszaj innych ćwiczeń
nie rób enterprise recommendations
nie rób production critique
focus on understanding
bazuj na realnym kodzie
nie zgaduj
zaznacz assumptions
explain deeply
educational tone
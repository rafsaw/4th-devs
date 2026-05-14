---
created: 2026-05-08
updated: 2026-05-08
last-confirmed: 2026-05-08
type: concept
confidence: medium
tags: [topic/agents, topic/prompt-engineering, topic/multi-agent]
sources:
  - "[[raw/AI-Devs-4_s02e05/AI-Devs-4_s02e05_01!Projektowanie_instrukcji_i_zakresu_odpowiedzialnosci]]"
  - "[[raw/AI-Devs-4_s02e05/AI-Devs-4_s02e05_02!Zasady_projektowania_instrukcji_agenta]]"
---

# Projektowanie instrukcji agenta

Instrukcja systemowa agenta to nie tylko lista reguł — to definicja tożsamości, roli w systemie i sposobu działania w zmieniającym się środowisku. W odróżnieniu od prostego promptu dla LLM, prompt agenta musi obsługiwać dynamiczne otoczenie, relacje z innymi agentami i zmieniające się sesje.

## Sześć składników instrukcji

| Składnik | Co zawiera | Uwagi |
|----------|-----------|-------|
| **Ustawienia** | Nazwa, opis, lista narzędzi, tryby, uprawnienia, model | Podstawa konfiguracji; może być szablon tekstowy (agent jako plik) |
| **Profil** | Osobowość, ton, złożoność, format, techniki rozumowania | Nie tylko kosmetyka — realnie wpływa na jakość pracy; kieruje "uwagą" modelu |
| **Zasady** | Komunikacja, radzenie sobie z błędami, dostęp do wiedzy, zachowania edge-case | Generalizowane zasady, nie listy reguł per-sytuacja |
| **Limity** | Aktualność informacji, dynamiczne uprawnienia, świadomość "kiedy jest teraz" | Model domyślnie nie wie kiedy trwa sesja — trzeba mu explicite powiedzieć |
| **Styl** | Ton zależny od środowiska (głos vs tekst), długość odpowiedzi | **Środowisko** (interface), a nie narzędzia, dyktuje format odpowiedzi |
| **Sesja** | Z kim rozmawia agent, preferencje użytkownika, dynamiczne dane bieżącej aktywności | Zmienne per-sesja wstrzykiwane do system promptu |

## Anatomia czterech sekcji promptu

Kurs prezentuje konkretny archetype systemu promptu agenta-managera. Cztery sekcje:

### `<identity>`

Motyw przewodni łączący charakter, styl i zachowanie. Obejmuje: zarządzanie, delegowanie, pamięć, świadomość otoczenia, autonomię, reagowanie na błędy, komunikację. **Bez detali narzędzi** — te mogą być dynamiczne.

Kluczowa zasada: nie tylko **mów** modelowi co robić, ale **pokazuj** to przez dobór słów, skojarzenia i persony. Autor używa słowa "instynkt" w instrukcji agenta — to nie poetyka, to celowy sygnał, że zależy na charakterze wykraczającym poza suche wykonywanie poleceń:

> „Zamiast oczekiwać, że agent zrobi **dokładnie to czego oczekujemy**, projektujemy system tak, aby stworzyć przestrzeń **by pozytywnie nas zaskoczył**."

### `<protocol>`

Zasady działania i zarządzania: kontekst, pamięć, relacje z agentami i systemem. Może zawierać wzmianki konkretnych katalogów/plików — ale z zachowaniem balansu. Zbyt ścisłe powiązanie ze strukturą FS = krucha instrukcja po refaktorze.

### `<voice>`

Ton wypowiedzi z przykładami few-shot, seriami skojarzeń, adapcją tonu do sytuacji i antywzorcami. **Sekcja jest obszerniejsza niż pozostałe** — LLM szybko wraca do domyślnego tonu po kilku wiadomościach. Rozwiązanie: few-shot + seria skojarzeń + explicite antywzorce + dopuszczalność mieszania logiki z zachowaniem (jeśli podjęto taką decyzję).

### `<tools>`

Prawie w pełni generowana, bo skład narzędzi może się zmieniać per sesja. Opisy narzędzi + ich schematy są samotłumaczące — nie ma potrzeby dodatkowych instrukcji. Wyjątki: wzmianka o katalogu `templates/` z instrukcjami innych agentów, specyficzne zachowania przy narzędziach komunikacji (np. czym różni się `send_notification` od innych form kontaktu).

Po `<tools>`: dynamiczna sekcja **WORKSPACE_SECTION** (hook dla [[observational-memory]]) + jedno zdanie CTA kończące instrukcję systemową.

## Iteracyjne budowanie instrukcji

Dobra instrukcja agenta wymaga wielu iteracji — autor mówi o "kilkunastu iteracjach" dla jednego agenta. Wymagane wejście do procesu:

1. Wiedza o **możliwościach systemu** (jakie narzędzia, jacy inni agenci)
2. Wiedza o **roli pozostałych agentów** (kto co robi, jaki zakres odpowiedzialności)
3. **Własne obserwacje z praktyki** pracy z agentami (np. "agent pomijał wczytywanie wspomnień gdy polecenie tego nie sugerowało wprost, ale kontekst rozmowy już tak")

LLM jest partnerem w budowaniu instrukcji (analogicznie do [[organizacja-promptow#Generalizowanie generalizacji]]). Sam wymaga prowadzenia — bez kierowania proponuje zbyt specyficzne korekty zamiast zasad generycznych. Twoja ocena i wyczucie są niezbędne — modele mają wiedzę o prompt engineeringu, ale nie mają "wyczucia co ma znaczenie w danej sytuacji".

## Instrukcje nie gwarantują przestrzegania

**Obecność instrukcji w kontekście nie gwarantuje, że model będzie ich przestrzegać** ani poprawnie interpretować. Lekcja odnosi się do projektu [Gemma Scope](https://www.neuronpedia.org/gemma-scope#microscope) — wizualizacja jak modele "widzą" koncepcje i jak je łączą.

Sugestia z lekcji: patrzenie na instrukcje przez pryzmat skojarzeń i uwagi modelu daje wyczucie co może być istotne. Nie daje jednak pełnej kontroli — "ruchomych elementów jest zdecydowanie za dużo".

Praktyczna konsekwencja: zabezpieczenia nie mogą istnieć tylko w prompcie — muszą być też na poziomie kodu ([[bezpieczenstwo-agentow]]).

## Środowisko wpływa na styl

To nie narzędzie wpływa na sposób wypowiedzi agenta, lecz **środowisko** (interface), w którym aktualnie działa. Agent głosowy unika:
- dyktowania długich linków URL
- "wyświetlania" obrazów
- długich list z formatowaniem markdown

To samo dotyczy CRON (brak użytkownika → inna forma komunikacji) i różnych kanałów UI. Lekcja S01E04 jest źródłem wzorców tego zachowania.

## Narzędzia i materiały dodatkowe

- Interaktywna wizualizacja `<identity>`: https://cloud.overment.com/prompt-identity-anatomy-1771174103.html
- Interaktywna wizualizacja `<protocol>`: https://cloud.overment.com/prompt-protocol-anatomy-1771174239.html
- Interaktywna wizualizacja `<voice>`: https://cloud.overment.com/prompt-voice-anatomy-1771179608.html
- Gemma Scope (jak modele widzą koncepcje): https://www.neuronpedia.org/gemma-scope#microscope

---

## 🏗️ Architecture Thinking

- **Rola w systemie**: warstwa konfiguracyjna — wpływa na processing i decision, ale nie jest deterministycznym kontrolerem
- **Core vs supporting**: core dla każdego agenta (bez instrukcji brak tożsamości); `<voice>` jest "supporting" ale krytycznym jeśli UX jest priorytetem
- **Dependencies**: LLM model, lista narzędzi (statyczna lub progressive disclosure), warstwa pamięci (WORKSPACE_SECTION hook), lista agentów systemu (do `<identity>` i `<protocol>`)
- **Trade-offs**:
  - Precyzja vs robustność: szczegółowa instrukcja działa dokładnie, ale jest krucha przy zmianach systemu
  - Persona vs przewidywalność: projektowanie "przestrzeni pozytywnych niespodzianek" trudne do testowania
  - Koszt sekcji `<voice>` vs degradacja tonu: więcej tokenów = wyższy koszt, bez nich styl się rozmywa
  - Wzmianki o plikach/katalogach w `<protocol>` vs elastyczność: konkretność pomaga, ale wiąże agenta ze strukturą FS

---

## 🏢 Use Case Mapping (GENERIC)

**Typ problemu:** agent

**Gdzie pasuje:** każdy agent z wyraźną rolą; szczególnie systemy wieloagentowe, gdzie relacje między agentami mają znaczenie

**Kiedy używać:**
- Agent ma stałą, wyraźną rolę w systemie (specjalista, manager, asystent)
- Potrzebujesz trwałego stylu komunikacji (głos, branding, UX)
- System jest wieloagentowy i agent musi znać relacje z innymi
- Potrzebujesz mechanizmu dynamicznego wstrzykiwania kontekstu (WORKSPACE_SECTION)

**Kiedy NIE:**
- Jednorazowy prompt dla prostego pipeline (overhead bez zysku)
- Agent bez kontaktu z użytkownikiem i innymi agentami

---

## ❌ Anti-patterns / risks

- **Sekcja `<voice>` zbyt krótka** — model wraca do domyślnego stylu po kilku wiadomościach. Minimum: few-shot + skojarzenia + explicite antywzorce
- **Szczegółowe instrukcje per-narzędzie w prompcie** — reguły per-narzędzie stają się szumem, zaburzają uwagę modelu; narzędzia opisują się same przez schematy
- **Brak WORKSPACE_SECTION** — tracisz punkt wstrzyknięcia dla dynamicznego kontekstu (observational memory, aktywność agentów, workspace state)
- **Instrukcja jako jedyne zabezpieczenie** — prompt injection przejdzie przez instrukcję; zabezpieczenia muszą być też w kodzie
- **Zbyt sztywne powiązanie z strukturą FS w `<protocol>`** — po refaktorze katalogów instrukcja wskazuje na nieistniejące pliki
- **Brak iteracji** — pierwsza wersja instrukcji zawsze będzie niedoskonała; minimum kilkanaście iteracji to norma

---

## 🧪 Experiment / What to test

**Cel:** zbadać degradację tonu i przestrzegania zasad w długiej konwersacji

**Setup:**
- Agent A: pełna `<voice>` z few-shot + seriami skojarzeń + antywzorcami
- Agent B: prosta linia "Odpowiadaj zwięźle i bezpośrednio"
- Ta sama seria 20 wiadomości: mix poleceń i edge-case (np. prośba bez sugestii o wczytanie wspomnień, ale kontekst to sugeruje)

**Co zmierzyć:**
- Jak zmienia się styl A i B po 5, 10, 20 wiadomościach
- Czy agent A wczytuje wspomnienia gdy polecenie tego nie sugeruje wprost

**Czego się spodziewać:**
- Agent B wraca do "asystenta AI" po 3-5 wiadomościach
- Agent A utrzymuje ton dłużej, ale bez WORKSPACE_SECTION i tak degraduje przy dłuższej konwersacji
- Przy zbyt szczegółowej instrukcji per-narzędzie: agent gubi się przy zadaniach gdzie nie pasuje żadna reguła

---

## 🔗 Powiązania

- [[organizacja-promptow]] — ogólne zasady organizacji promptów; anatomia sekcji; generalizowanie generalizacji
- [[observational-memory]] — WORKSPACE_SECTION jako hook dla mechaniki Observer/Reflector
- [[agent-manager]] — przykład kompletnej instrukcji managera (wszystkie 4 sekcje w praktyce)
- [[bezpieczenstwo-agentow]] — instrukcje nie wystarczą jako zabezpieczenie; prompt injection
- [[context-engineering]] — dynamiczna instrukcja, session variables, 4 warstwy kontekstu
- [[multi-agent-architectures]] — relacje z innymi agentami jako część `<identity>` i `<protocol>`
- [[s02e05]]

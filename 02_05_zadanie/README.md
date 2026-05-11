# 02_05_zadanie - drone

Implementacja zgodna z podejsciem 2-agentowym:

- Agent 1 (`Map Analyst`) analizuje obraz mapy po URL i zwraca sektor tamy jako JSON.
- Agent 2 (`Drone Operator`) najpierw pobiera dokumentacje API z `drone.html`, prosi LLM o ekstrakcje kontraktu i dopiero potem iteracyjnie buduje instrukcje dla `/verify` (z poprawkami na podstawie bledow API).
- Kazdy run zapisuje trace do `output/` takze gdy misja konczy sie bledem (`result.status = "failed"`).

## Mechanizmy konwergencji (Agent 2)

Aby ograniczyc zapetlenia po feedbacku API, `Drone Operator` ma dodatkowe mechanizmy:

- **Blocked coordinates memory** - gdy API zwraca komunikat typu "you will drop it somewhere nearby", para `set(x,y)` z tej proby trafia do listy zablokowanej i nie moze byc uzyta ponownie w kolejnych probach.
- **Ordering constraint z feedbacku API** - gdy API sygnalizuje brak instrukcji powrotu mimo obecnego `set(return)`, agent aktywuje hipoteze kolejnosci i wymusza uklad:
  - `set(return)` przed `flyToLocation`
  - brak komend `set(...)` po `flyToLocation`
- **Local validation before `/verify`** - plan jest najpierw walidowany lokalnie (placeholders, brakujace komendy, zablokowane wspolrzedne, aktywne constraints), a dopiero potem wysylany do API.

W trace (`output/run-*.json`) zobaczysz to w polach iteracji:

- `activeOrderingConstraint`
- `blockedCoordinates`
- `activeStructureConstraint`

## Uruchomienie

```bash
cd 02_05_zadanie
npm start
```

## Wymagane zmienne w root `.env`

- `AG3NTS_API_KEY`
- `OPENROUTER_API_KEY` (preferowane) albo `OPENAI_API_KEY`
- `DRONE_MAP_URL` - URL mapy (mozna podac placeholder `tutaj-twoj-klucz` lub `tutaj-twój-klucz`)
- `DRONE_DOCS_URL` - URL dokumentacji API drona (domyslnie `https://hub.ag3nts.org/dane/drone.html`)

Przyklad:

```env
DRONE_MAP_URL=https://example.org/map.png?apikey=tutaj-twoj-klucz
```

## Opcjonalne zmienne

- `DRONE_MODEL` - np. `openrouter:gpt-5.4` albo `gpt-4o`
- `DRONE_MAP_MODEL` - model dla Agenta 1 (vision)
- `DRONE_OPERATOR_MODEL` - model dla Agenta 2 (planowanie instrukcji)
- `DRONE_DOCS_MODEL` - model dla analizy `drone.html` (domyslnie taki jak `DRONE_OPERATOR_MODEL`)
- `DRONE_AI_PROVIDER` - `openrouter` lub `openai`
- `DRONE_VERIFY_ENDPOINT` - domyslnie `https://hub.ag3nts.org/verify`
- `DRONE_MAP_AGENT_ATTEMPTS` - domyslnie `3`
- `DRONE_AGENT_MAX_ATTEMPTS` - domyslnie `12`
- `DRONE_DOCS_MAX_ATTEMPTS` - domyslnie `2` (ile razy LLM moze poprawiac ekstrakcje dokumentacji)
- `DRONE_AGENT_RESET_AFTER` - domyslnie `3`
- `DRONE_MAP_MAX_OUTPUT_TOKENS` - domyslnie `300`
- `DRONE_DOCS_MAX_OUTPUT_TOKENS` - domyslnie `900`
- `DRONE_OPERATOR_MAX_OUTPUT_TOKENS` - domyslnie `700`
- `DRONE_REFLECTION_MAX_OUTPUT_TOKENS` - domyslnie `450` (self-reflection step przy powtarzajacych sie bledach)
- `DRONE_HARD_RESET_PAYLOAD` - JSON lub string dla resetu, domyslnie `"hardReset"`

## Gdzie ustawic modele

Modele ustawiasz w **rootowym** pliku `.env` repo:

- `c:\Users\rafal\repos\4th-devs\.env`

Przykladowa konfiguracja (tanszy Agent 2):

```env
# Agent 1 (mapa / vision)
DRONE_MAP_MODEL=openai/gpt-5.4

# Agent 2 (docs + planowanie)
DRONE_DOCS_MODEL=openai/gpt-4.1-mini
DRONE_OPERATOR_MODEL=openai/gpt-4.1-mini

# Token caps per etap
DRONE_MAP_MAX_OUTPUT_TOKENS=300
DRONE_DOCS_MAX_OUTPUT_TOKENS=900
DRONE_OPERATOR_MAX_OUTPUT_TOKENS=700
```

Po zmianie `.env` uruchom ponownie:

```bash
cd 02_05_zadanie
npm start
```

W logu startowym zobaczysz aktywne modele:

- `mapModel=...`
- `docsModel=...`
- `operatorModel=...`

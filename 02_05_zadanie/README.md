# 02_05_zadanie - drone

Implementacja zgodna z podejsciem 2-agentowym:

- Agent 1 (`Map Analyst`) analizuje obraz mapy po URL i zwraca sektor tamy jako JSON.
- Agent 2 (`Drone Operator`) iteracyjnie buduje instrukcje dla `/verify`, poprawia je na podstawie bledow i wykonuje `hardReset` po serii porazek.

## Uruchomienie

```bash
cd 02_05_zadanie
npm start
```

## Wymagane zmienne w root `.env`

- `AG3NTS_API_KEY`
- `OPENROUTER_API_KEY` (preferowane) albo `OPENAI_API_KEY`
- `DRONE_MAP_URL` - URL mapy (mozna podac placeholder `tutaj-twoj-klucz` lub `tutaj-twój-klucz`)

Przyklad:

```env
DRONE_MAP_URL=https://example.org/map.png?apikey=tutaj-twoj-klucz
```

## Opcjonalne zmienne

- `DRONE_MODEL` - np. `openrouter:gpt-5.4` albo `gpt-4o`
- `DRONE_AI_PROVIDER` - `openrouter` lub `openai`
- `DRONE_VERIFY_ENDPOINT` - domyslnie `https://hub.ag3nts.org/verify`
- `DRONE_MAP_AGENT_ATTEMPTS` - domyslnie `3`
- `DRONE_AGENT_MAX_ATTEMPTS` - domyslnie `12`
- `DRONE_AGENT_RESET_AFTER` - domyslnie `3`
- `DRONE_HARD_RESET_PAYLOAD` - JSON dla resetu, domyslnie `{"action":"hardReset"}`

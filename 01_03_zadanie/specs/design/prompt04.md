Teraz przygotuj spec-driven warstwę definicji narzędzi.

Wymagania:

- utwórz plik `specs/tools.schema.json`
- opisz dwa tools w formacie zgodnym z function/tool calling:
  - check_package
  - redirect_package
- każdy tool ma mieć:
  - name
  - description
  - input schema
- opisy parametrów mają być napisane tak, żeby model dobrze rozumiał kiedy użyć danego narzędzia
- niech schema będzie trzymana poza kodem i ładowana przez `llm.js`

Dodatkowo:

- utwórz lub uzupełnij:
  - `specs/api-contract.md`
  - `specs/session-model.md`
  - `specs/agent-rules.md`

Na końcu:

1. pokaż finalną treść tools.schema.json
2. wyjaśnij krótko, dlaczego dobre opisy tools są ważne dla modelu


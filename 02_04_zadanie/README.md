# s02e04 — `mailbox`

Agent FC przeszukujący skrzynkę mailową operatora Systemu przez API zmail i ekstrahujący trzy wartości potrzebne do otrzymania flagi z huba.

## Cel

Z maili Wiktora (`proton.me`) wyciągnąć:

| Pole | Co | Format |
|---|---|---|
| `date` | Kiedy dział bezpieczeństwa atakuje elektrownię | `YYYY-MM-DD` |
| `password` | Hasło do systemu pracowniczego | string |
| `confirmation_code` | Kod z ticketu działu bezpieczeństwa | `^SEC-.{32}$` (36 znaków) |

Wysłać do `POST https://hub.ag3nts.org/verify` z `task: "mailbox"` i odebrać flagę `{FLG:...}`.

Pełna analiza zadania: [`02_04_zadanie_podejscie.md`](./02_04_zadanie_podejscie.md).

## Stack

- TypeScript + tsx (bez build-stepu)
- `openai` SDK skierowany na OpenRouter
- Model: `google/gemini-3-flash-preview` (rekomendacja zadania — tani, ekstrakcja faktów)

## Konfiguracja

Plik `.env` w katalogu zadania:

```
OPENROUTER_API_KEY=sk-or-v1-...
AG3NTS_API_KEY=4999b7d1-...
ZMAIL_URL=https://hub.ag3nts.org/api/zmail
HUB_VERIFY_URL=https://hub.ag3nts.org/verify
MODEL=google/gemini-3-flash-preview
MAX_ITER=30
```

## Uruchomienie

```bash
npm install
npx tsx src/index.ts
```

Po sukcesie:
- `output/flag.txt` — sama flaga `{FLG:...}`
- `output/run-<timestamp>.json` — pełen log konwersacji (system prompt, tool calls, odpowiedzi huba)

## Smoke test (opcjonalny)

Sprawdza dostępność API zmail przed odpaleniem agenta:

```bash
npx tsx src/smoke.ts
```

Wypisuje wynik `help` (lista dostępnych akcji) i pierwszą stronę `getInbox`.

## Struktura

```
src/
├── config.ts     # ładowanie .env, walidacja wymaganych zmiennych
├── zmail.ts      # klient API: help / getInbox / getThread / getMessages / search
├── hub.ts        # POST /verify + detekcja flagi {FLG:...}
├── tools.ts      # definicje FC (6 narzędzi) + regex walidacja przed wysyłką
├── prompt.ts     # system prompt + wrapper <email_content> dla niezaufanej treści
├── smoke.ts      # ad-hoc test API (help + getInbox)
└── index.ts      # pętla agenta, zapis flagi i run.json
```

## Narzędzia agenta (Function Calling)

| Tool | Co robi |
|---|---|
| `zmail_search` | wyszukiwanie maili (`from:`, `subject:`, `OR`, `AND`) — metadane bez treści |
| `zmail_get_inbox` | strona inboxa — perspektywa „co jest w skrzynce" |
| `zmail_get_thread` | lista messageID w wątku (RE:) |
| `zmail_read` | treść maili po ID (batch przez `getMessages`); wynik owinięty w `<email_content>` |
| `submit_answer` | POST do huba; pola opcjonalne (inkrementalnie); regex check przed wysyłką |
| `wait_seconds` | pauza 1–30 s — skrzynka jest aktywna, mail może wpłynąć później |
| `finish` | kończy pętlę po fladze |

## Decyzje projektowe (skrót z `02_04_zadanie_podejscie.md`)

- **Mało narzędzi, dobrze opisanych** — manager nie przeładowany, zgodnie z `agent-manager.md`.
- **Inkrementalne `submit_answer`** — feedback huba ukierunkowuje kolejną iterację (Deep Action).
- **`<email_content>` jako strefa untrusted** — obrona przed prompt injection w treści maili.
- **Walidacja regex przed wysyłką** — `^SEC-.{32}$` i `YYYY-MM-DD`; źle sformatowane wartości nie idą do huba, agent dostaje zwrotkę i szuka dalej.
- **Aktywna skrzynka** — `wait_seconds` na wypadek, gdy mail jeszcze nie dotarł.
- **`temperature: 0`** — deterministyczna ekstrakcja, mniej halucynacji.

## Wynik

Pierwsze uruchomienie: 6 iteracji, flaga `{FLG:TRAITOR}` zapisana do `output/flag.txt`.

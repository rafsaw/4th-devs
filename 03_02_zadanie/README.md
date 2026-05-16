# 03_02_zadanie — firmware

# RS>!!!! Ten kod tu nie dziala uzylem Klaudiusz zeby zrobil kod !!!!

Agentic task: run `/opt/firmware/cooler/cooler.bin` on a restricted Linux VM via shell API, retrieve the `ECCS-xxx` code, and submit it to Centrala.

## Requirements

- Node.js 24+
- Root `.env` with `AG3NTS_API_KEY` and `OPENROUTER_API_KEY`

## Install

```bash
npm install --prefix ./03_02_zadanie
```

Or from the repo root using the shared install script:

```bash
npm run lesson12:install
```

## Run

From the repo root:

```bash
npm run lesson12:firmware
```

Or directly from this directory:

```bash
cd 03_02_zadanie
npx tsx --env-file=../.env agent.ts
```

## How it works

The agent connects to `https://hub.ag3nts.org/api/shell` and executes shell commands on the VM in a loop:

1. Runs `help` to discover available commands
2. Explores `/opt/firmware/cooler/`
3. Reads `.gitignore` and avoids listed paths
4. Attempts to run `cooler.bin`, reads the error
5. Finds the access password (stored in multiple places on the system)
6. Inspects and fixes `settings.ini`
7. Re-runs `cooler.bin` to get the `ECCS-xxx` code
8. Submits the code to Centrala via `/report`

Shell API errors (ban, rate limit, 503) are handled inside the `shell_exec` tool — the agent receives a human-readable description instead of raw HTTP responses.

The ECCS code format is validated with a regex before sending to Centrala so hallucinated codes are rejected at the code level.

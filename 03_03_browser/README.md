# 03_03_browser

Browser automation agent with Playwright, session persistence, and MCP file tools. The agent opens a real browser, navigates websites as an authenticated user, takes screenshots, clicks elements, extracts content, and saves results to files — all driven by natural language chat.

---

## Prerequisites

### 1. Node.js 24+

The project requires Node.js 24. Check your version:

```bash
node --version
```

If you have an older version, download Node.js 24 from [nodejs.org](https://nodejs.org/).

> **Windows note:** The login browser window is opened via a separate Node.js script (`scripts/login.mjs`) because Playwright's browser launch hangs under Bun on Windows. The chat agent runs via `tsx` under Node.js for the same reason.

### 2. API key

Set at least one key in the repo root `.env` file:

| Variable | Provider |
|---|---|
| `OPENAI_API_KEY` | OpenAI (Responses API) |
| `OPENROUTER_API_KEY` | OpenRouter (proxies OpenAI models) |

The provider is auto-detected from whichever key is present. If both are set, set `AI_PROVIDER=openai` or `AI_PROVIDER=openrouter` to pick one explicitly.

### 3. Model

In `03_03_browser/.env`, set the model you want to use:

```
MODEL=gpt-4o
```

The default is `gpt-5.2` if not set. `gpt-4o` is recommended for reliability with tool calls.

### 4. A Goodreads account

Required for authenticated browsing. Free account at [goodreads.com](https://www.goodreads.com).

### 5. Install dependencies

From inside the `03_03_browser` folder:

```bash
npm install
```

This installs Playwright and all other dependencies. Playwright's browser binaries (Chromium) are included automatically.

---

## Running the agent

### Step 1 — Login (one-time)

Run from the **repo root**:

```bash
npm run lesson13:browser:login
```

What happens:
- An Edge browser window opens and navigates to the Goodreads sign-in page
- Log into your Goodreads account manually in that window
- Come back to the terminal and **press Enter**
- Your session cookies are saved to `03_03_browser/data/session.json`

You only need to do this once. Repeat it when your session expires (usually after a few weeks).

### Step 2 — Start the chat agent

Run from the **repo root**:

```bash
npm run lesson13:browser
```

What happens:
- Playwright launches a headless Chromium browser with your saved session cookies
- The MCP file server starts, giving the agent access to the workspace files
- An interactive chat prompt appears

Example queries to try:
- `List all books by Jim Collins`
- `Find top-rated books about strategy`
- `What are the most popular books on my to-read shelf?`

Type `quit` or `exit` to stop.

---

## How it works

```
You (chat) → Agent loop → Browser tools (navigate, click, screenshot, extract)
                       → MCP file tools (read, write, search files)
                       → AI model (gpt-4o via OpenAI or OpenRouter)
```

1. **Browser** — Playwright launches Chromium (headless) with your saved Goodreads session. The agent can navigate to any URL, take screenshots, click elements, type text, and extract page content.

2. **Session persistence** — On login, Playwright saves all cookies and local storage to `data/session.json`. On subsequent runs, this file is loaded into the browser context so the agent browses as your authenticated account.

3. **MCP file server** — A local MCP (Model Context Protocol) server exposes three file tools: `fs_read`, `fs_write`, `fs_search`. The agent uses these to read site navigation guides from the `instructions/` folder and write results or discoveries to files.

4. **Agentic loop** — The agent runs up to 30 turns per query. Each turn: the model decides what to do → calls a tool → gets the result → decides the next step. The full conversation history is maintained locally each run (not server-side), which makes it compatible with OpenRouter.

5. **Site instructions** — The `instructions/` folder contains Markdown files that describe how to navigate specific sites (e.g., `instructions/goodreads.md`). The agent reads these at the start of each query to know the site's URL patterns, selectors, and quirks. Add your own instruction files for other sites.

---

## Scraping other websites

The agent is not limited to Goodreads. To use it with any other site:

1. Log in to the target site via the login script (modify `scripts/login.mjs` to navigate to that site's login URL instead of Goodreads)
2. Create an instruction file at `instructions/<hostname>.md` describing the site structure
3. Ask the agent questions about that site

### Sites with popups or permission dialogs

- **Cookie/GDPR banners** — the agent handles these by taking a screenshot and clicking the appropriate button, no code changes needed
- **Browser permission dialogs** (location, notifications) — these must be pre-granted in the Playwright browser context in `src/browser.ts`:

```typescript
const context = await browser.newContext({
  geolocation: { latitude: 52.23, longitude: 21.01 },
  permissions: ['geolocation'],
});
```

### Connecting to your own running browser

For sites with CAPTCHAs or aggressive bot detection, you can launch Edge/Chrome yourself, do all the manual steps, then attach Playwright to that live session:

```javascript
// Launch Edge manually with: msedge.exe --remote-debugging-port=9222
const browser = await chromium.connectOverCDP('http://localhost:9222');
```

This gives Playwright full control of an already-authenticated, human-looking browser session.

---

## File structure

```
03_03_browser/
├── scripts/
│   └── login.mjs          # Login helper (runs with plain Node.js)
├── src/
│   ├── index.ts            # Entry point (login | chat modes)
│   ├── browser.ts          # Playwright browser management + session
│   ├── mcp.ts              # MCP client connection
│   ├── prompt.ts           # System prompt builder
│   ├── log.ts              # Logging utilities
│   ├── agent/
│   │   ├── runner.ts       # Agentic loop (multi-turn, full history)
│   │   ├── model.ts        # OpenAI Responses API calls
│   │   ├── tool-executor.ts# Tool call dispatch + error handling
│   │   ├── interventions.ts# Mid-run hints injected into conversation
│   │   └── types.ts
│   ├── tools/
│   │   ├── browser-tools.ts# navigate, screenshot, click, type, extract
│   │   ├── mcp-tools.ts    # fs_read, fs_write, fs_search wrappers
│   │   ├── artifacts.ts    # Page content saving
│   │   └── types.ts
│   └── feedback/           # Tool call outcome tracking + hints
├── instructions/           # Per-site navigation guides (Markdown)
├── data/                   # Runtime data: session.json, screenshots, pages
├── .env                    # Local env (MODEL, API keys override)
└── package.json
```

---

## Troubleshooting

**Browser window does not open during login**
On Windows, the bundled Playwright Chromium may hang under Bun. The login script uses Node.js + Edge instead. Make sure Edge is installed at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.

**`Bun is not defined` error**
All `Bun.main` references have been replaced with `import.meta.url`. If you see this, check that you are running the chat agent with `npm run lesson13:browser` (Node.js via tsx), not `bun src/index.ts`.

**`400 Provider returned error` on turn 2**
This happens when `previous_response_id` is used with a provider that does not support server-side conversation state (e.g. OpenRouter). The agent now maintains full conversation history locally, so this should not occur. If it does, check that your `MODEL` in `.env` supports tool calls.

**Session expired**
Re-run `npm run lesson13:browser:login` to refresh the cookies.

# Session Model

## Overview

Each operator conversation is identified by a `sessionID` string (provided by the caller).
Sessions live in-process in a `Map<sessionID → messages[]>` — no external storage.

## Message format

Messages follow the OpenAI Responses API input format:

```json
{ "role": "user",      "content": "operator message" }
{ "role": "assistant", "content": "agent reply"       }
```

Tool call turns also include raw `function_call` and `function_call_output` items
as returned/expected by the Responses API — these are stored verbatim so the full
context is preserved for subsequent turns.

## Lifecycle

- Session is created lazily on first message.
- Each request appends: user message → model output items → tool results (if any).
- Sessions are never explicitly deleted (process restart clears all sessions).
- After each request, `sessions/<sessionID>.json` is written to disk for debugging.

## Limits

- No trimming or summarization — context grows indefinitely.
- For long sessions (100+ turns) consider adding a sliding window in `memory.js`.

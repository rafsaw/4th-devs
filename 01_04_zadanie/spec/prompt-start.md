# 13. Startowy prompt do Cursor

You are my AI pair-programmer helping me implement task `sendit` inside folder `01_04_zadanie`.

IMPORTANT CONTEXT:

* This is NOT about generating final solution immediately
* This is step-by-step implementation based on spec-driven development
* We must reuse patterns from existing folders `01_04_*`
* We must use Files MCP like in examples
* We must build agent + tools/helpers, not a single procedural script
* We must persist structured state on disk
* We must implement tracing and sessions from the beginning

GOAL:
Build an agent-based solution that:

* explores documentation from `https://hub.ag3nts.org/dane/doc/index.md`
* processes multiple files including images via vision
* finds declaration template
* extracts rules for routes, transport types, cost and system-funded shipment
* builds structured draft first
* generates final declaration string
* sends it to `/verify`
* iterates based on feedback
* stores traces and session logs as JSON files

CRITICAL RULES:

1. Do NOT generate full solution at once
2. Work step-by-step
3. Always explain:

   * what you are doing
   * why
   * which `01_04_*` example you are using as inspiration
4. Prefer adapting existing patterns instead of inventing new ones
5. Separate:

   * agent logic
   * tools
   * services
   * schemas
   * workspace
   * tracing
   * sessions
6. Use structured JSON internally, not only strings
7. Persist important state on disk
8. Add tracing from the beginning

PROJECT FOLDERS TO USE:

* `spec/json-schemas/` for spec-level JSON contracts
* `src/schemas/` for runtime validators/types
* `workspace/traces/` for actual trace logs
* `workspace/sessions/` for actual session logs

INTERNAL DATA STRUCTURES:

`declarationDraft`

```json
{
  "declarationDraft": {
    "senderId": "450202122",
    "from": "Gdańsk",
    "to": "Żarnowiec",
    "weightKg": 2800,
    "cargo": "kasety z paliwem do reaktora",
    "transportType": null,
    "routeCode": null,
    "cost": null,
    "isSystemFunded": null,
    "specialNotes": null,
    "templatePath": null,
    "declarationText": null,
    "status": "in_progress"
  }
}
```

`knowledge`

```json
{
  "knowledge": {
    "templateFound": false,
    "templateLocation": null,
    "relevantDocuments": [],
    "routeCode": null,
    "transportTypes": [],
    "rules": {},
    "missingData": [],
    "openQuestions": [],
    "notes": []
  }
}
```

`verify payload`

```json
{
  "apikey": "ENV_API_KEY",
  "task": "sendit",
  "answer": {
    "declaration": "<FINAL DECLARATION STRING>"
  }
}
```

`trace entry`

```json
{
  "timestamp": "2026-03-29T20:30:00.000Z",
  "sessionId": "sendit-session-001",
  "stepId": "step-001",
  "type": "tool_call",
  "name": "fetch_document",
  "input": {},
  "output": {},
  "status": "success",
  "comment": ""
}
```

`session`

```json
{
  "sessionId": "sendit-session-001",
  "task": "sendit",
  "startedAt": "2026-03-29T20:30:00.000Z",
  "status": "running",
  "objective": "Build valid SPK declaration for free/system-funded shipment from Gdańsk to Żarnowiec",
  "keyInputs": {
    "senderId": "450202122",
    "from": "Gdańsk",
    "to": "Żarnowiec",
    "weightKg": 2800,
    "cargo": "kasety z paliwem do reaktora"
  },
  "importantDecisions": [],
  "artifacts": {
    "templatePath": null,
    "knowledgePath": "workspace/notes/knowledge.json",
    "draftPath": "workspace/drafts/declaration-draft.json",
    "finalDeclarationPath": null
  },
  "verifyAttempts": [],
  "finalOutcome": null
}
```

FIRST TASK:

Do NOT write full code.

Step 1:

* Analyze folders `01_04_*` in this repo
* Identify which ones are most relevant for this task
* Explain why

Step 2:

* Propose minimal architecture for `01_04_zadanie`
* Include:

  * agent
  * tools
  * services
  * schemas
  * workspace
  * tracing
  * sessions

Step 3:

* Decide what should be agent responsibility and what should be deterministic tools/helpers

STOP after that.

Do NOT implement full solution yet.
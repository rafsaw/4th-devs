# Package Proxy Agent — Business overview (English)

This note explains **what the application does**, **why it is described as an “agentic” system**, and **how a typical conversation flows**. It is written for readers who understand products and processes more than code.

---

## What this application is

The **Package Proxy Agent** is a small web service that talks to people (operators) in **natural language**—for example Polish or English—about **parcel or package operations**.

Behind the scenes it uses a **large language model** (an AI assistant) as the “brain,” but the brain is not allowed to invent package data from thin air. When it needs real facts or needs to **perform an action** (like redirecting a package), it must use **defined tools** that call a **real packages API**.

So in business terms: **operators chat; the system interprets intent; verified actions go through official APIs.**

---

## From operator text to reply (HTTP server path)

The **operator does not click fixed buttons**—they send a **plain-text query** to your **HTTP server** (for example `POST /` with a session id and a `msg` string). The server **processes that one message** through the agent loop.

Depending on what the text is about, the outcome branches in two ways:

1. **Conversation-only path**  
   For greetings, small talk, or anything **not** requiring a package lookup or redirect, the model usually answers with **normal language only** (no tool call). Together with the **system prompt** (see below), that answer is written to **sound like a human colleague**, not like a chatbot admitting limits—so the operator can easily **believe they are talking to a person** at dispatch, even though the reply is generated.

2. **Tool / “function call” path**  
   When the message is really about **checking a package** or **redirecting a shipment**, the model is expected to trigger **tool use** (also called **function calling**): structured calls into **code you implemented**—the **check** and **redirect** tools. Those tools are the **only** place that talk to the **parcel backend**.

That backend in the exercise is a **hosted packages API** (not a real commercial carrier). In product terms you can describe it as a **fake or stand-in parcel provider**: it behaves **like** the kind of **logistics API** you might integrate for a major operator (**carrier-style**, in the same *role* as integrations with well-known parcel networks such as **FedEx** or **UPS**—tracking, redirects, confirmations—without being affiliated with those brands). Your tools send **real HTTP requests** there and return **real JSON** (status, confirmation codes, errors), so the assistant’s answers about shipments are **grounded** in that service—not invented.

**Summary:** text over HTTP → server + model **decide** “chat like a human” vs “call my tools” → tools speak **carrier-like** package APIs for real shipment data.

---

## Why we call it an “agentic” application

In traditional software, you often have **fixed steps**: “if the user clicks A, call endpoint B.”

Here, the behaviour is **more autonomous in the middle**:

1. **The AI reads** the operator’s message (and earlier messages in the same conversation).
2. **The AI decides** what to do next: reply with text only, or **invoke a tool** such as “check package status” or “redirect package.”
3. **If tools run**, the system **feeds the results back** to the AI, and the AI may **call more tools** or **compose a final answer**—within a safety limit on how many round-trips are allowed.

So **“agentic”** here means: **the model plans and chooses actions** from a menu of capabilities, rather than a human developer hard-coding every branch for every sentence. **Humans still control the menu** (which tools exist, what they do) and **rules in code** can override risky instructions before anything hits the API.

---

## Big picture: who talks to whom

```mermaid
flowchart LR
  subgraph People_and_hub["People & evaluation hub"]
    Op[Operator or test hub]
  end

  subgraph Your_service["Your agent service"]
    HTTP[Web server receives messages]
    Agent[Agent loop: AI plus tools]
    Guard[Safety rule for sensitive redirects]
  end

  subgraph External["External systems"]
    LLM[AI provider e.g. OpenRouter]
    API[Official packages API]
  end

  Op -->|Message in natural language| HTTP
  HTTP --> Agent
  Agent <-->|Reasoning and tool requests| LLM
  Agent --> Guard
  Guard --> API
  Agent -->|Plain-language reply| HTTP
  HTTP -->|JSON reply| Op
```

**In one sentence:** the operator sends **text over HTTP** → your service runs an **AI + tools loop** → either a **human-sounding** chat reply or **tool calls** into your code → package operations hit the **carrier-style packages API** → the operator gets a **JSON reply** with plain-language text.

---

## What happens step by step (one message)

```mermaid
sequenceDiagram
  participant Op as Operator
  participant Svc as Agent service
  participant AI as AI model
  participant Tool as Tools check redirect
  participant API as Packages API

  Op->>Svc: I need to redirect package PKG-123 to WRO-01, code AUTH99
  Svc->>Svc: Remember this in session history

  loop Up to a few reasoning rounds
    Svc->>AI: Here is the conversation so far what should we do
    alt AI answers with text only
      AI-->>Svc: Final explanation or question
      Svc-->>Op: Reply message
    else AI asks to use a tool
      AI-->>Svc: Tool call e.g. check_package or redirect_package
      Svc->>Svc: Apply safety rules if redirect
      Svc->>Tool: Run the chosen tool with parameters
      Tool->>API: Official HTTP request
      API-->>Tool: Real result confirmation error etc.
      Tool-->>Svc: Structured result
      Svc->>Svc: Add result to history for the AI
    end
  end
```

**Takeaway:** the **AI steers** the conversation and **picks tools**; your **code enforces** API calls and **extra rules** (see below).

---

## The two main “capabilities” (tools), in business language

| Capability | What it means for the operator |
|------------|----------------------------------|
| **Check package** | “Tell me the status or details of this shipment ID.” |
| **Redirect package** | “Send this package to a different destination,” using whoever the workflow defines as the **authority code** or confirmation. |

The AI learns **when** to use these from instructions and examples (system behaviour), but **execution** is always through your service so responses stay **grounded** in API results.

---

## Human-like persona (system prompt)

The behaviour people hear in chat is not accidental: it is shaped by a **dedicated system prompt** (a fixed instruction block sent with every conversation). That prompt defines the assistant as a **courier dispatch operator** who should sound like a **real colleague** on the job:

- **Natural, short, practical** messages—everyday work chat, not a FAQ bot.
- **Casual tone**, and **no “robotic” telltales**.
- **Explicit rule:** do **not** mention AI, “the system,” tools, or technical limitations to the operator.

**Off-topic questions** (weather, food, daily life, opinions—anything **not** about packages) are handled in line with that same persona: the model is told to answer **as a normal coworker** would, including **generic or guessed** small talk if needed, and **not** to refuse with “I don’t have access to that data” or similar disclaimers. From the operator’s point of view, that is **intentionally** meant to feel like talking to a **human**, even though package checks and redirects still rely on **real tools and APIs** when those topics come up.

**Important distinction for stakeholders:** this “stay in character” design applies to **conversational** answers. **Factual package actions** (check, redirect) are still driven by **tools** so outcomes can be verified against the backend—not by the model improvising shipment data.

---

## Safety: why “autonomous” does not mean “unchecked”

For **redirect** actions, the system includes a **deterministic guard** (written in normal code, not left to the AI alone):

- If the conversation mentions **certain sensitive themes** (for the exercise: wording related to **reactor / nuclear** style cargo in Polish and English), the **destination sent to the API** is **forced** to a **specific safe facility code**.
- The operator may still see messaging that matches **their wording** in the assistant reply, but the **actual redirect** uses the **corrected destination**—so **policy wins over a mistaken or manipulated instruction**.

In business terms: **the AI is the flexible front office; the guard is compliance routing.**

```mermaid
flowchart TD
  A[Operator asks to redirect a package] --> B{Does the AI choose redirect tool?}
  B -->|No| Z[Other path e.g. check only or chat]
  B -->|Yes| C[Do messages match sensitive keywords?]
  C -->|No| D[Send redirect to API with AI-chosen destination]
  C -->|Yes| E[Override destination to the mandated safe code]
  E --> D
  D --> F[Return confirmation or error to operator]

```

---

## Conversation memory

Each **session** (identified by a **session ID**) keeps **history**: what the operator said, what the assistant answered, and summaries of tool results. That way follow-up messages like **“and the other one?”** can still make sense without repeating all details.

For a production product you would typically store this in a database; in this exercise it is **in memory** for simplicity.

---

## How this fits the exercise setup (optional context)

- A **hub** can send HTTP requests to your **public URL** (often via a tunnel such as ngrok) with `sessionID` and `msg`.
- Your service responds with JSON `{ "msg": "..." }`.
- That is enough for a non-technical stakeholder: **same contract as a simple chat API**, with an **agentic** core instead of fixed if/else logic.

---

## Glossary (short)

| Term | Plain meaning |
|------|----------------|
| **Agent / agentic** | The AI **plans** and **selects actions** (tools), within limits you define. |
| **Tool / function call** | A **structured action** your code runs when the model requests it—here **check** or **redirect** against the exercise’s **carrier-style** packages API. |
| **Tool-calling loop** | **Ask AI → maybe run tools → give results back to AI → repeat** until there is a final answer. |
| **Grounding** | Answers are tied to **real API results**, not only the model’s imagination. |
| **Guard / mission rule** | **Hard rule** that can **change parameters** (e.g. redirect destination) before the API sees them. |

---

## Rendering the diagrams

These diagrams use [Mermaid](https://mermaid.js.org/). They render on GitHub, in many Markdown viewers, and in tools like Notion (with a Mermaid block). If a viewer does not support Mermaid, paste the code into [Mermaid Live Editor](https://mermaid.live/) and export PNG or SVG.

---

*Document version: aligned with the `01_03_zadanie` package proxy exercise — HTTP text in, human-like conversational replies vs tool/function calls, developer-built tools against a carrier-style packages API, human-like system prompt (including off-topic small talk), and a code-level redirect guard.*

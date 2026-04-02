# Sendit Declaration Agent — Business Overview

This document explains the **business and domain** aspects of the `01_04_zadanie` solution: what problem it solves, who the actors are, what rules govern a valid shipment declaration, and how success is measured. For containers, APIs, and code structure, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Executive summary

The **Sendit** exercise is a learning scenario set in a fictional **post-apocalyptic rail parcel network** called **SPK** (*System Przesyłek Konduktorskich* — Conductor Parcel System). The **business outcome** is to produce a **formally correct shipping declaration** for a specific cargo and have it **accepted** by a central verification service, which returns a **success token (flag)**.

Rather than a human filling the form, this solution uses an **autonomous LLM-driven agent** that:

1. Discovers and reads official SPK documentation hosted remotely  
2. Derives template structure, route codes, fee and category rules  
3. Fills a declaration that satisfies **zero-budget (0 PP)** and **template fidelity** constraints  
4. Submits to verification and **self-corrects** using feedback  

From a business perspective, the agent is a **digital worker** that automates **compliance research + data entry + submission** for a single, well-defined shipment.

---

## 2. Domain model (conceptual)

```mermaid
mindmap
  root((SPK domain))
    Network
      Origin points
      Destination points
      Routes and codes
      Excluded routes policy
    Cargo
      Weight
      Category A-E
      Special goods reactor fuel cassettes
    Commercial rules
      Fees in PP
      System-funded categories
      WDP additional wagons
    Compliance
      Załącznik E template
      Oath statement
      Verifier as authority
```

---

## 3. Actors and responsibilities

```mermaid
flowchart LR
    subgraph Human_side
        OP[Operator / student]
    end
    subgraph Automated
        AG[Declaration agent]
    end
    subgraph Authority
        DOC[Documentation publisher hub.ag3nts.org]
        VER[Verification API]
    end

    OP -->|runs process, reviews artifacts| AG
    AG -->|reads specs| DOC
    AG -->|submits declaration| VER
    VER -->|accept / reject + hints| AG
```

| Actor | Role |
|-------|------|
| **Operator** | Starts the run, supplies API keys, inspects `workspace/` and traces for learning |
| **Agent (LLM + tools)** | Interprets regulations, builds declaration, iterates on validation and verify feedback |
| **Documentation host** | Source of truth for templates, routes, categories, pricing tables, maps (including images) |
| **Verification service** | Authoritative gate: only its response counts as **business acceptance** |

---

## 4. The business “order” — fixed shipment

The task is **not** an open-ended chat; it is a **single shipment** with fixed master data (also embedded in `src/config.js` and the runtime user query in `app.js`).

| Attribute | Value |
|-----------|-------|
| Task name | `sendit` |
| Sender ID (NADAWCA) | `450202122` |
| Origin (PUNKT NADAWCZY) | Gdańsk |
| Destination (PUNKT DOCELOWY) | Żarnowiec |
| Weight | 2800 kg |
| Cargo description | Kasety z paliwem do reaktora |
| **Budget constraint** | **0 PP** — must be free or system-funded |

```mermaid
flowchart LR
    subgraph Shipment
        O[Gdańsk]
        D[Żarnowiec]
        W[2800 kg]
        C[Reactor fuel cassettes]
        B[0 PP]
    end
    O --> D
    W --> DECL[Valid declaration]
    C --> DECL
    B --> DECL
```

---

## 5. Business process (four phases)

The **system instructions** given to the model encode a **linear pipeline** with feedback loops. This is the business process the agent is expected to follow.

```mermaid
flowchart TD
    START([Run started]) --> P1

    subgraph P1["Phase 1 — Discover documentation"]
        P1a[Fetch index.md] --> P1b[Resolve includes and links]
        P1b --> P1c[Fetch attachments A–H and related files]
        P1c --> P1d{Image?}
        P1d -->|yes| P1e[Save + vision analysis]
        P1d -->|no| P1f[Store text + expose to model]
        P1e --> P1g[Record facts in knowledge]
        P1f --> P1g
    end

    P1 --> P2

    subgraph P2["Phase 2 — Analyze and structure"]
        P2a[Identify template Załącznik E] --> P2b[Route code for corridor]
        P2b --> P2c[Fee exemptions categories]
        P2c --> P2d[Excluded routes + eligible categories]
        P2d --> P2e[WDP rules from weight vs wagon capacity]
        P2e --> P2f[Persist template + knowledge + draft]
    end

    P2 --> P3

    subgraph P3["Phase 3 — Construct declaration"]
        P3a[Fill all template fields] --> P3b[render_declaration]
        P3b --> P3c{Local validation}
        P3c -->|fail| P3d[Correct and retry]
        P3d --> P3a
        P3c -->|pass| P3e[Final text saved]
    end

    P3 --> P4

    subgraph P4["Phase 4 — Verify and learn"]
        P4a[verify_declaration] --> P4b{Remote result}
        P4b -->|success| END([Done — flag / code 0])
        P4b -->|failure| P4c[Interpret hint, update draft]
        P4c --> P3a
    end
```

---

## 6. Value chain (business data lineage)

```mermaid
flowchart LR
    subgraph Inputs
        REG[Regulatory corpus remote MD + images]
        ORD[Fixed shipment master data]
    end
    subgraph Interpretation
        SYN[Synthesis by LLM]
    end
    subgraph Artifacts
        KB[knowledge.json]
        DR[draft JSON]
        TMPL[Template file]
        FIN[final-declaration.txt]
    end
    subgraph Outcome
        ACK[Verifier acceptance]
    end

    REG --> SYN
    ORD --> SYN
    SYN --> KB
    SYN --> DR
    SYN --> TMPL
    KB & DR & TMPL --> FIN
    FIN --> ACK
```

**Business meaning of artifacts:**

| Artifact | Purpose |
|----------|---------|
| `knowledge.json` | Structured **memory** of interpreted rules (route, categories, notes) |
| `declaration-draft.json` | **Work in progress** for field values and status |
| `final-declaration.txt` | **Customer-facing document** equivalent — what would be filed |
| `verify-logs/*.json` | **Audit trail** of each submission attempt |

---

## 7. Business rules vs technical enforcement

Some rules are **policy** (the model must obey via instructions); others are **machine-checked** before or during submission.

| Rule | Business intent | How enforced |
|------|-----------------|--------------|
| Match **Załącznik E** layout | Interoperability with SPK back office | Instructions + **regex validation** (markers, fields, separators, oath) |
| **KWOTA DO ZAPŁATY: 0 PP** | Shipment must be system-funded | Instructions + **exact string check** on cost line |
| **KATEGORIA PRZESYŁKI** | Correct exemption class | Instructions + pattern `[A-E]` in validator |
| Route / exclusions | Safety and network policy | Instructions + evidence from docs and **vision** on map image |
| Verifier hints | Final interpretation of “correct” | **Human-readable feedback loop** in conversation |

---

## 8. Collaboration scenario: local vs remote quality gates

From a **risk management** perspective, the pipeline uses **two lines of defense**.

```mermaid
sequenceDiagram
    participant Agent as Agent
    participant Local as Local validation
    participant Remote as Verification API

    Agent->>Local: render / pre-verify check
    alt Local fail
        Local-->>Agent: Issues list no charge to reputation
        Note over Agent: Fix formatting and semantics before retry
    else Local pass
        Local-->>Agent: OK
        Agent->>Remote: Submit declaration
        Remote-->>Agent: Accept or reject + message
    end
```

**Business benefit:** avoid **unnecessary rejections** and **noisy attempts** for purely syntactic mistakes (e.g. `0` instead of `0 PP`), while still treating the **remote verifier** as the only final authority.

---

## 9. Success criteria and KPIs (learning / exercise context)

| Metric | Meaning |
|--------|---------|
| **Verifier success** | HTTP response interpreted as success (`code === 0` or flag-like message) |
| **Iteration count** | How many render/verify cycles were needed — proxy for **process efficiency** |
| **Local validation failures** | How often the agent needed **correction before submit** |
| **Trace completeness** | Whether the run is **auditable** for coursework |

```mermaid
flowchart TD
    Q{Verifier returned success?}
    Q -->|Yes| WIN[Business goal met flag or OK code]
    Q -->|No| RETRY{Under retry budget?}
    RETRY -->|Yes| FIX[Adjust declaration from message]
    FIX --> Q
    RETRY -->|No| LOSE[Failed run — inspect verify-logs and trace]
```

---

## 10. Constraints and assumptions

- **Single-run autonomy:** the model is instructed not to ask the user questions mid-flight.  
- **Documentation is authoritative:** field values must be **evidence-based** from docs, not guessed.  
- **Restricted attachments:** some documents may return “higher clearance” messages — business response is to **skip** and continue.  
- **Learning priority:** rich tracing and persistent workspace trump production hardening (see [README.md](./README.md)).

---

## 11. Glossary

| Term | Meaning |
|------|---------|
| **SPK** | Fictional conductor parcel system in the exercise |
| **PP** | Currency unit for fees in the scenario |
| **WDP** | Additional wagons beyond a standard consist (business field on the form) |
| **Załącznik E** | Attachment containing the **declaration template** |
| **Verifier** | Remote service that validates the submission for task `sendit` |
| **Flag** | Token proving successful completion in the exercise |

---

## 12. Related documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — technical architecture, sequences, data flow  
- [README.md](./README.md) — runbook and event types  
- [specs/ARCHITECTURE.md](./specs/ARCHITECTURE.md) — combined deep dive with example timeline  

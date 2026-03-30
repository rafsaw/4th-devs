import { resolveModelForProvider } from "../../config.js";

const AG3NTS_API_KEY = process.env.AG3NTS_API_KEY?.trim() ?? "";

if (!AG3NTS_API_KEY) {
  console.warn("\x1b[33mWarning: AG3NTS_API_KEY is not set in .env — verify_declaration will fail\x1b[0m");
  console.warn("         Add AG3NTS_API_KEY=your-key to the root .env file");
}

export const api = {
  model: resolveModelForProvider("gpt-4.1"),
  visionModel: resolveModelForProvider("gpt-4.1"),
  maxOutputTokens: 16384,
  instructions: `You are an autonomous documentation explorer and declaration builder agent for the SPK transport system.

## GOAL
Explore the SPK documentation starting from the index, find the declaration template, extract all required rules (routes, transport types, costs, system-funded categories), and build a valid SPK declaration for the shipment described below.

## SHIPMENT DATA (from task)
- Sender ID: 450202122
- Origin: Gdańsk
- Destination: Żarnowiec
- Weight: 2800 kg
- Cargo: kasety z paliwem do reaktora
- Budget: 0 PP (shipment must be free or system-funded)

## PROCESS
1. EXPLORE: Fetch the documentation index from the remote URL. Read it carefully.
2. FOLLOW LINKS: The documentation contains references to other files. These may be markdown files, text files, or images. Follow ALL references — build a complete picture. References might appear as:
   - Standard markdown links [text](url)
   - Bare relative paths like /doc/file.md or ./file.png
   - Filenames mentioned inline in text
   - Construct full URLs using base: https://hub.ag3nts.org/dane/doc/
3. HANDLE IMAGES: If a referenced file is an image (.png, .jpg, .gif, .webp), download it and use analyze_image to extract its content. Do NOT skip images — they may contain critical information like route maps, tables, or templates.
4. BUILD KNOWLEDGE: As you discover facts, update the knowledge file using update_knowledge. Track:
   - Declaration template (exact format)
   - Route codes for Gdańsk → Żarnowiec
   - Transport type categories
   - Cost rules and which categories are system-funded (0 PP)
   - Any constraints or special rules
5. FIND TEMPLATE: Locate the exact declaration template/format. Save it to workspace/templates/.
6. BUILD DRAFT: Once you have enough knowledge, build a structured draft with all field values. Use update_draft to persist it.
7. RENDER: Use render_declaration to produce the final declaration string from template + draft data.
8. VALIDATE: Check the rendered declaration against the template format before submitting.
9. VERIFY: Submit via verify_declaration. Read the response carefully.
10. ITERATE: If verify returns an error or hint, analyze the feedback, adjust the draft, re-render, and retry.

## RULES
- NEVER guess field values — extract them from documentation
- NEVER add special notes unless documentation explicitly requires them
- The declaration must match the template format EXACTLY
- Cost must be 0 PP — find the transport type/category that makes this possible
- Work incrementally: explore → understand → draft → verify → fix
- Save all downloaded documents to workspace for reference
- After each major discovery, update knowledge

## AVAILABLE WORKSPACE
- workspace/documents/ — downloaded documentation files
- workspace/images/ — downloaded images from docs
- workspace/notes/knowledge.json — accumulated knowledge
- workspace/templates/ — found declaration template(s)
- workspace/drafts/declaration-draft.json — current draft
- workspace/verify-logs/ — verify attempt responses

## COMMUNICATION
Report what you're doing at each step. When you find important information, summarize it briefly before continuing.`
};

export const task = {
  name: "sendit",
  senderId: "450202122",
  from: "Gdańsk",
  to: "Żarnowiec",
  weightKg: 2800,
  cargo: "kasety z paliwem do reaktora"
};

export const docs = {
  indexUrl: "https://hub.ag3nts.org/dane/doc/index.md",
  baseUrl: "https://hub.ag3nts.org/dane/doc/"
};

export const verify = {
  endpoint: "https://centrala.ag3nts.org/report",
  apiKey: AG3NTS_API_KEY
};

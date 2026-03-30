import { readFile, writeFile, mkdir } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { vision } from "../helpers/api.js";
import { task, docs, verify as verifyConfig } from "../config.js";
import log from "../helpers/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

const getMimeType = (filepath) => {
  const ext = extname(filepath).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp"
  };
  return mimeTypes[ext] || "image/jpeg";
};

const ensureDir = async (dirPath) => {
  await mkdir(dirPath, { recursive: true });
};

const TEMPLATE_START_MARKER = "SYSTEM PRZESYŁEK KONDUKTORSKICH - DEKLARACJA ZAWARTOŚCI";
const TEMPLATE_END_MARKER = "======================================================";
const TEMPLATE_OATH = "OŚWIADCZAM, ŻE PODANE INFORMACJE SĄ PRAWDZIWE.";

const REQUIRED_FIELDS = [
  { label: "DATA", pattern: /^DATA: .+$/m },
  { label: "PUNKT NADAWCZY", pattern: /^PUNKT NADAWCZY: .+$/m },
  { label: "NADAWCA", pattern: /^NADAWCA: .+$/m },
  { label: "PUNKT DOCELOWY", pattern: /^PUNKT DOCELOWY: .+$/m },
  { label: "TRASA", pattern: /^TRASA: .+$/m },
  { label: "KATEGORIA PRZESYŁKI", pattern: /^KATEGORIA PRZESYŁKI: [A-E]$/m },
  { label: "OPIS ZAWARTOŚCI", pattern: /^OPIS ZAWARTOŚCI.*: .+$/m },
  { label: "DEKLAROWANA MASA", pattern: /^DEKLAROWANA MASA.*: .+$/m },
  { label: "WDP", pattern: /^WDP: .+$/m },
  { label: "KWOTA DO ZAPŁATY", pattern: /^KWOTA DO ZAPŁATY: .+$/m },
];

export const nativeTools = [
  {
    type: "function",
    name: "fetch_remote_url",
    description: "Fetch content from a remote URL. For text files returns the content as string. For binary/image files, saves to workspace/images/ and returns the local path. Use this to download documentation files and images from the SPK documentation.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL to fetch (e.g., 'https://hub.ag3nts.org/dane/doc/index.md')"
        },
        save_as: {
          type: "string",
          description: "Optional filename to save as in workspace/documents/ (for text) or workspace/images/ (for images). If omitted, derived from URL."
        }
      },
      required: ["url"],
      additionalProperties: false
    },
    strict: false
  },
  {
    type: "function",
    name: "analyze_image",
    description: "Analyze an image file using vision AI. Use this for images found in documentation that may contain route maps, tables, templates, or other critical information.",
    parameters: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "Path to the image file relative to project root (e.g., 'workspace/images/routes.png')"
        },
        question: {
          type: "string",
          description: "What to look for in the image (e.g., 'What route codes are shown?', 'Extract the declaration template from this image')"
        }
      },
      required: ["image_path", "question"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "update_knowledge",
    description: "Update the knowledge base with newly discovered facts. Merges new data into workspace/notes/knowledge.json. You MUST pass updates inside the 'updates' property. Example: { \"updates\": { \"templateFound\": true, \"routeCode\": \"X-01\", \"notes\": [\"Category A is system-funded\"] } }",
    parameters: {
      type: "object",
      properties: {
        updates: {
          type: "object",
          description: "Object with fields to update. Keys: templateFound (bool), templateLocation (string), routeCode (string), transportTypes (string[]), rules (object), relevantDocuments (string[]), missingData (string[]), openQuestions (string[]), notes (string[]). Arrays are merged, objects are deep-merged, scalars are overwritten.",
          additionalProperties: true
        }
      },
      required: ["updates"],
      additionalProperties: false
    },
    strict: false
  },
  {
    type: "function",
    name: "update_draft",
    description: "Update the declaration draft with field values. Merges into workspace/drafts/declaration-draft.json. Use to build the declaration incrementally as you discover values.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          description: "Fields to update in the draft. Can include: transportType, routeCode, cost, isSystemFunded, specialNotes, templatePath, declarationText, status",
          additionalProperties: true
        }
      },
      required: ["fields"],
      additionalProperties: false
    },
    strict: false
  },
  {
    type: "function",
    name: "render_declaration",
    description: "Save the final declaration text. You must construct the declaration yourself by filling the template fields with values from the draft/knowledge. This tool saves the text, runs local validation, updates the draft, and returns the result for review before verification.",
    parameters: {
      type: "object",
      properties: {
        declaration_text: {
          type: "string",
          description: "The complete declaration text you constructed by filling the template with the correct field values"
        }
      },
      required: ["declaration_text"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "verify_declaration",
    description: "Submit the declaration to the verification endpoint. Sends POST to /verify with task='sendit' and the declaration string. Returns the verification response.",
    parameters: {
      type: "object",
      properties: {
        declaration: {
          type: "string",
          description: "The complete declaration string to submit"
        }
      },
      required: ["declaration"],
      additionalProperties: false
    },
    strict: true
  }
];

/**
 * Local validation — Step 13.
 * Deterministic checks before hitting the verify endpoint.
 */
const validateDeclaration = (text, tracer) => {
  const issues = [];

  if (!text.includes(TEMPLATE_START_MARKER)) {
    issues.push("Missing template start marker (header line)");
  }
  if (!text.trim().endsWith(TEMPLATE_END_MARKER)) {
    issues.push("Missing template end marker (closing ====== line)");
  }
  if (!text.includes(TEMPLATE_OATH)) {
    issues.push("Missing oath/declaration statement");
  }

  for (const { label, pattern } of REQUIRED_FIELDS) {
    if (!pattern.test(text)) {
      issues.push(`Missing or malformed field: ${label}`);
    }
  }

  const costMatch = text.match(/^KWOTA DO ZAPŁATY: (.+)$/m);
  if (costMatch && costMatch[1].trim() !== "0 PP") {
    issues.push(`Cost must be 0 PP, got: ${costMatch[1].trim()}`);
  }

  const separatorCount = (text.match(/^-{40,}$/gm) || []).length;
  if (separatorCount < 8) {
    issues.push(`Expected at least 8 separator lines (------), found ${separatorCount}`);
  }

  const valid = issues.length === 0;

  tracer?.record("validation.result", { valid, issueCount: issues.length, issues });

  return { valid, issues };
};

const nativeHandlers = {
  async fetch_remote_url({ url, save_as }, tracer) {
    log.start(`Fetching: ${url}`);
    tracer?.record("tool.fetch_remote_url.start", { url, save_as });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const isImage = contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(url);

    const rawName = save_as || url.split("/").pop() || "file";
    const filename = rawName.split("/").pop();

    if (isImage) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const savePath = join(PROJECT_ROOT, "workspace/images", filename);
      await ensureDir(join(PROJECT_ROOT, "workspace/images"));
      await writeFile(savePath, buffer);

      const result = {
        type: "image",
        url,
        localPath: `workspace/images/${filename}`,
        size: buffer.length,
        note: "Image saved. Use analyze_image to read its content."
      };
      tracer?.record("tool.fetch_remote_url.result", { url, type: "image", filename, size: buffer.length });
      return result;
    }

    const text = await response.text();
    const savePath = join(PROJECT_ROOT, "workspace/documents", filename);
    await ensureDir(join(PROJECT_ROOT, "workspace/documents"));
    await writeFile(savePath, text, "utf-8");

    const result = {
      type: "text",
      url,
      localPath: `workspace/documents/${filename}`,
      content: text,
      length: text.length
    };
    tracer?.record("tool.fetch_remote_url.result", { url, type: "text", filename, length: text.length });
    return result;
  },

  async analyze_image({ image_path, question }, tracer) {
    const fullPath = join(PROJECT_ROOT, image_path);
    log.vision(image_path, question);
    tracer?.record("tool.analyze_image.start", { image_path, question });

    const imageBuffer = await readFile(fullPath);
    const imageBase64 = imageBuffer.toString("base64");
    const mimeType = getMimeType(image_path);

    const answer = await vision({ imageBase64, mimeType, question, tracer });
    log.visionResult(answer);

    tracer?.record("tool.analyze_image.result", { image_path, answerLength: answer.length });
    return { answer, image_path };
  },

  async update_knowledge(args = {}, tracer) {
    let updates = args.updates;
    if (!updates || typeof updates !== "object" || Object.keys(updates).length === 0) {
      const { updates: _ignored, ...rest } = args;
      if (Object.keys(rest).length > 0) {
        updates = rest;
      } else {
        tracer?.record("tool.update_knowledge.skipped", { reason: "empty args" });
        return { status: "skipped", reason: "No updates provided. Pass { updates: { templateFound: true, routeCode: 'X-01' } }" };
      }
    }

    tracer?.record("tool.update_knowledge.start", { updateKeys: Object.keys(updates) });

    const knowledgePath = join(PROJECT_ROOT, "workspace/notes/knowledge.json");
    await ensureDir(join(PROJECT_ROOT, "workspace/notes"));

    let knowledge;
    try {
      const content = await readFile(knowledgePath, "utf-8");
      knowledge = JSON.parse(content);
    } catch {
      knowledge = {
        templateFound: false,
        templateLocation: null,
        relevantDocuments: [],
        routeCode: null,
        transportTypes: [],
        rules: {},
        missingData: [],
        openQuestions: [],
        notes: []
      };
    }

    for (const [key, value] of Object.entries(updates)) {
      if (Array.isArray(knowledge[key]) && Array.isArray(value)) {
        knowledge[key] = [...new Set([...knowledge[key], ...value])];
      } else if (typeof knowledge[key] === "object" && knowledge[key] !== null && typeof value === "object" && value !== null && !Array.isArray(value)) {
        knowledge[key] = { ...knowledge[key], ...value };
      } else {
        knowledge[key] = value;
      }
    }

    await writeFile(knowledgePath, JSON.stringify(knowledge, null, 2), "utf-8");
    tracer?.record("tool.update_knowledge.result", { updatedKeys: Object.keys(updates) });
    return { status: "updated", knowledge };
  },

  async update_draft({ fields }, tracer) {
    tracer?.record("tool.update_draft.start", { fieldKeys: Object.keys(fields) });

    const draftPath = join(PROJECT_ROOT, "workspace/drafts/declaration-draft.json");
    await ensureDir(join(PROJECT_ROOT, "workspace/drafts"));

    let draft;
    try {
      const content = await readFile(draftPath, "utf-8");
      draft = JSON.parse(content);
    } catch {
      draft = {
        senderId: task.senderId,
        from: task.from,
        to: task.to,
        weightKg: task.weightKg,
        cargo: task.cargo,
        transportType: null,
        routeCode: null,
        cost: null,
        isSystemFunded: null,
        specialNotes: null,
        templatePath: null,
        declarationText: null,
        status: "in_progress"
      };
    }

    Object.assign(draft, fields);
    await writeFile(draftPath, JSON.stringify(draft, null, 2), "utf-8");
    tracer?.record("tool.update_draft.result", { updatedKeys: Object.keys(fields) });
    return { status: "updated", draft };
  },

  async render_declaration({ declaration_text }, tracer) {
    tracer?.record("tool.render_declaration.start", { charCount: declaration_text.length });

    const validation = validateDeclaration(declaration_text, tracer);

    const draftPath = join(PROJECT_ROOT, "workspace/drafts/declaration-draft.json");
    await ensureDir(join(PROJECT_ROOT, "workspace/drafts"));

    let draft;
    try {
      const content = await readFile(draftPath, "utf-8");
      draft = JSON.parse(content);
    } catch {
      draft = {
        senderId: task.senderId,
        from: task.from,
        to: task.to,
        weightKg: task.weightKg,
        cargo: task.cargo,
        status: "in_progress"
      };
    }

    draft.declarationText = declaration_text;
    draft.status = validation.valid ? "rendered" : "validation_failed";
    draft.lastValidation = validation;
    await writeFile(draftPath, JSON.stringify(draft, null, 2), "utf-8");

    const declarationPath = join(PROJECT_ROOT, "workspace/drafts/final-declaration.txt");
    await writeFile(declarationPath, declaration_text, "utf-8");

    tracer?.record("tool.render_declaration.result", {
      valid: validation.valid,
      issues: validation.issues,
      savedTo: "workspace/drafts/final-declaration.txt"
    });

    return {
      status: validation.valid ? "saved" : "validation_failed",
      validation,
      declaration_text,
      savedTo: "workspace/drafts/final-declaration.txt",
      charCount: declaration_text.length
    };
  },

  async verify_declaration({ declaration }, tracer) {
    tracer?.record("tool.verify_declaration.start", { charCount: declaration.length });

    const preCheck = validateDeclaration(declaration, tracer);
    if (!preCheck.valid) {
      tracer?.record("verify.blocked_by_validation", { issues: preCheck.issues });
      return {
        success: false,
        blocked: true,
        reason: "Local validation failed — fix these issues before submitting",
        issues: preCheck.issues
      };
    }

    const payload = {
      apikey: verifyConfig.apiKey,
      task: task.name,
      answer: {
        declaration
      }
    };

    log.start(`Verifying declaration (${declaration.length} chars)...`);

    const response = await fetch(verifyConfig.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { code: response.status, message: rawText.substring(0, 500) };
    }

    const attemptLog = {
      timestamp: new Date().toISOString(),
      declaration,
      response: data,
      httpStatus: response.status
    };

    const logDir = join(PROJECT_ROOT, "workspace/verify-logs");
    await ensureDir(logDir);
    const logFile = join(logDir, `verify-${Date.now()}.json`);
    await writeFile(logFile, JSON.stringify(attemptLog, null, 2), "utf-8");

    const success = data?.code === 0 || data?.message?.includes("flag") || data?.message?.includes("FLG");
    log.verify(attemptLog.timestamp, success);

    tracer?.record("verify.result", {
      success,
      httpStatus: response.status,
      code: data?.code,
      message: data?.message,
      logFile: `workspace/verify-logs/${logFile.split(/[\\/]/).pop()}`
    });

    return { success, data, logFile: `workspace/verify-logs/${logFile.split(/[\\/]/).pop()}` };
  }
};

export const isNativeTool = (name) => name in nativeHandlers;

export const executeNativeTool = async (name, args, tracer) => {
  const handler = nativeHandlers[name];
  if (!handler) throw new Error(`Unknown native tool: ${name}`);
  return handler(args, tracer);
};

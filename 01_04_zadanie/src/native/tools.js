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
    description: "Update the knowledge base with newly discovered facts. Merges new data into workspace/notes/knowledge.json. Use after finding important information in documentation.",
    parameters: {
      type: "object",
      properties: {
        updates: {
          type: "object",
          description: "Object with fields to update in knowledge. Can include: templateFound (bool), templateLocation (string), routeCode (string), transportTypes (array), rules (object), relevantDocuments (array of strings), missingData (array), openQuestions (array), notes (array of strings)",
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
    description: "Save the final declaration text. You must construct the declaration yourself by filling the template fields with values from the draft/knowledge. This tool saves the text, updates the draft, and returns the result for review before verification.",
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
    description: "Submit the declaration to the verification endpoint. Sends POST to /report with task='sendit' and the declaration string. Returns the verification response.",
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

const nativeHandlers = {
  async fetch_remote_url({ url, save_as }) {
    log.start(`Fetching: ${url}`);

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

      return {
        type: "image",
        url,
        localPath: `workspace/images/${filename}`,
        size: buffer.length,
        note: "Image saved. Use analyze_image to read its content."
      };
    }

    const text = await response.text();
    const savePath = join(PROJECT_ROOT, "workspace/documents", filename);
    await ensureDir(join(PROJECT_ROOT, "workspace/documents"));
    await writeFile(savePath, text, "utf-8");

    return {
      type: "text",
      url,
      localPath: `workspace/documents/${filename}`,
      content: text,
      length: text.length
    };
  },

  async analyze_image({ image_path, question }) {
    const fullPath = join(PROJECT_ROOT, image_path);
    log.vision(image_path, question);

    const imageBuffer = await readFile(fullPath);
    const imageBase64 = imageBuffer.toString("base64");
    const mimeType = getMimeType(image_path);

    const answer = await vision({ imageBase64, mimeType, question });
    log.visionResult(answer);

    return { answer, image_path };
  },

  async update_knowledge(args = {}) {
    let updates = args.updates;
    if (!updates || typeof updates !== "object" || Object.keys(updates).length === 0) {
      const { updates: _ignored, ...rest } = args;
      if (Object.keys(rest).length > 0) {
        updates = rest;
      } else {
        return { status: "skipped", reason: "No updates provided. Pass { updates: { templateFound: true, routeCode: 'X-01' } }" };
      }
    }

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
    return { status: "updated", knowledge };
  },

  async update_draft({ fields }) {
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
    return { status: "updated", draft };
  },

  async render_declaration({ declaration_text }) {
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
    draft.status = "rendered";
    await writeFile(draftPath, JSON.stringify(draft, null, 2), "utf-8");

    const declarationPath = join(PROJECT_ROOT, "workspace/drafts/final-declaration.txt");
    await writeFile(declarationPath, declaration_text, "utf-8");

    return {
      status: "saved",
      declaration_text,
      savedTo: "workspace/drafts/final-declaration.txt",
      charCount: declaration_text.length
    };
  },

  async verify_declaration({ declaration }) {
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

    return { success, data, logFile: `workspace/verify-logs/${logFile.split(/[\\/]/).pop()}` };
  }
};

export const isNativeTool = (name) => name in nativeHandlers;

export const executeNativeTool = async (name, args) => {
  const handler = nativeHandlers[name];
  if (!handler) throw new Error(`Unknown native tool: ${name}`);
  return handler(args);
};

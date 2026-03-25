/**
 * MCP client bootstrap and helpers (stdio transport)
 *
 * What this file does
 * -------------------
 * - Reads `mcp.json` at the project root and picks one named **MCP server** entry (default `"files"`).
 * - **Spawns the MCP server subprocess** (e.g. files-mcp — see `command`/`args` in config) and connects over stdio using the
 *   official MCP SDK (JSON-RPC on stdin/stdout; stderr can be inherited for **MCP server** logs). This is **not** the HTTP server
 *   in `src/server.js`; that is started separately by `app.js`.
 * - Exposes `listMcpTools` / `callMcpTool` so the rest of the app talks to the **MCP server** without importing SDK types everywhere.
 * - Provides `mcpToolsToOpenAI` to map MCP tool schemas into OpenAI-style function definitions for the LLM.
 *
 * "Client for a specific MCP server" — does the code change per server?
 * ---------------------------------------------------------------------
 * No. This file is **generic**: it always constructs the same `Client` + `StdioClientTransport` from `@modelcontextprotocol/sdk`.
 * "Specific server" only means **which MCP subprocess you spawn** — the `command`, `args`, `env`, and optional cwd from
 * `mcpServers.<name>` in `mcp.json`. The **MCP protocol** (initialize, list_tools, call_tool, …) is identical for any compliant server.
 *
 * What *does* vary by MCP server is **runtime behavior**: tool names, descriptions, and JSON schemas come from whatever binary you
 * launched. This translator app is written assuming a filesystem-oriented MCP (e.g. `fs_read`); swapping in another MCP server would
 * keep this client code as-is but would break callers unless they use that server’s tools.
 *
 * Architecture (how this fits the app)
 * ------------------------------------
 * - `app.js` creates **one** MCP client session and passes it into the translation loop and **HTTP** route handlers.
 * - All file access for `workspace/` is intended to go through MCP tools, keeping paths and sandboxing (e.g. `FS_ROOT`) on the
 *   **MCP server** side rather than duplicating rules in Node.
 *
 * Production considerations
 * -------------------------
 * - **MCP child process**: the MCP server is a subprocess of this Node app; if the app exits without `client.close()`, the child may be
 *   left running or killed abruptly depending on OS — `app.js` closes the MCP client on SIGINT/SIGTERM.
 * - **Config**: `mcp.json` is loaded from disk at startup; changing it requires a restart. Do not commit secrets; use env vars
 *   in `mcpServers.<name>.env` or the host environment.
 * - **Paths**: transport `cwd` is the project root so relative paths in config (e.g. `FS_ROOT`, script paths) resolve predictably.
 * - **Observability**: `stderr: "inherit"` surfaces **MCP server** logs in the same terminal as the app; in some deployments you may
 *   want to capture or redirect stderr instead.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import log from "../helpers/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

/**
 * Loads the root `mcp.json` (Cursor-style `mcpServers` map).
 */
const loadMcpConfig = async () => {
  const configPath = join(PROJECT_ROOT, "mcp.json");
  const content = await readFile(configPath, "utf-8");
  return JSON.parse(content);
};

/**
 * Spawns the configured MCP server process and returns a connected SDK `Client`.
 * Server choice is config-only (`mcpServers[serverName]`); the protocol stack is unchanged.
 *
 * @param {string} [serverName="files"] - Key under `mcpServers` in `mcp.json`
 */
export const createMcpClient = async (serverName = "files") => {
  const config = await loadMcpConfig();
  const serverConfig = config.mcpServers[serverName];

  if (!serverConfig) {
    throw new Error(`MCP server "${serverName}" not found in mcp.json`);
  }

  // Same Client class for every server; only the spawned command/env differ.
  const client = new Client(
    { name: "mcp-translator-client", version: "1.0.0" },
    { capabilities: {} }
  );

  log.info(`Spawning MCP server: ${serverName}`);
  log.info(`Command: ${serverConfig.command} ${serverConfig.args.join(" ")}`);

  // stdio transport: MCP messages on child stdin/stdout; merge host PATH/HOME with server-specific env.
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: process.env.NODE_ENV,
      ...serverConfig.env
    },
    cwd: PROJECT_ROOT,
    stderr: "inherit"
  });

  await client.connect(transport);
  log.success(`Connected to ${serverName} via stdio`);

  return client;
};

/**
 * Fetches tool definitions from the connected **MCP server** (`tools/list` in MCP terms).
 */
export const listMcpTools = async (client) => {
  const result = await client.listTools();
  return result.tools;
};

/**
 * Invokes `name` with `arguments` on the **MCP server**. If the response includes a text part, tries `JSON.parse` for structured payloads.
 */
export const callMcpTool = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });

  const textContent = result.content.find((c) => c.type === "text");
  if (textContent) {
    try {
      return JSON.parse(textContent.text);
    } catch {
      return textContent.text;
    }
  }
  return result;
};

/**
 * Maps MCP `inputSchema` + metadata into OpenAI chat "function" tool objects (names/descriptions/schemas for the model).
 */
export const mcpToolsToOpenAI = (mcpTools) =>
  mcpTools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false
  }));

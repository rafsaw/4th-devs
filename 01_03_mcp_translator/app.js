/**
 * MCP Translator Agent — application entry point (composition root)
 *
 * What this file does
 * -------------------
 * 1. Bootstraps the **MCP client** against the configured **MCP server** (files-mcp child process, stdio; see `mcp.json`).
 * 2. Lists available MCP tools once and keeps client + tool metadata in module-level state for the rest of the app.
 * 3. Starts the translation loop (polls workspace/translate/, translates via the agent + MCP) without awaiting it,
 *    so it runs concurrently with the **HTTP server**.
 * 4. Starts the **HTTP server** (`src/server.js`) for on-demand translation; handlers receive the same MCP client/tools via a factory.
 *    (The HTTP server is not an MCP server — MCP runs only to the files-mcp subprocess.)
 * 5. Registers SIGINT/SIGTERM handlers for graceful shutdown: close the **MCP** transport, stop the **HTTP** server, then exit.
 *
 * Architecture (how the pieces fit)
 * --------------------------------
 * - MCP layer: this process owns the MCP session; file I/O for source/target dirs goes through MCP tools, not direct fs in routes.
 * - Two triggers: (a) background loop on a timer for drop-in files under translate/, (b) **HTTP API** (`src/server.js`) for explicit requests.
 * - Shared dependency: both paths use the same `mcpClient` and `mcpTools` created here, so there is a single MCP connection.
 *
 * Production considerations
 * -------------------------
 * - Binding: host/port come from env (PORT, HOST) via config; set these when deploying behind a reverse proxy or in containers.
 * - Process model: one Node process, one MCP connection; scaling horizontally would require separate workspaces or a different
 *   MCP deployment model to avoid conflicting file access and duplicate translation work.
 * - Lifecycle: the MCP subprocess (if launched by the client) is tied to this process; use a process manager (systemd, PM2, etc.)
 *   and rely on SIGTERM for clean shutdown so connections close predictably.
 * - Failures: uncaught startup errors in `main()` log and exit with code 1; there is no automatic restart — that belongs to the supervisor.
 */

import { createMcpClient, listMcpTools } from "./src/mcp/client.js";
import { runTranslationLoop } from "./src/translator.js";
import { startHttpServer } from "./src/server.js";
import { server as serverConfig } from "./src/config.js";
import log from "./src/helpers/logger.js";

let mcpClient = null;
let mcpTools = [];

const main = async () => {
  log.box("MCP Translator Agent\nAccurate translations to English with tone, formatting & nuances");

  // Connect to files-mcp (stdio transport, config in mcp.json)
  log.start("Connecting to MCP server (files-mcp subprocess)...");
  mcpClient = await createMcpClient();
  mcpTools = await listMcpTools(mcpClient);
  log.success(`Connected with ${mcpTools.length} tools: ${mcpTools.map(t => t.name).join(", ")}`);

  // Watch workspace/translate/ for new files
  runTranslationLoop(mcpClient, mcpTools);

  // HTTP API for on-demand translation
  const server = startHttpServer(serverConfig, () => ({ mcpClient, mcpTools }));

  const shutdown = async () => {
    log.warn("Shutting down...");
    if (mcpClient) await mcpClient.close();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch((error) => {
  log.error("Startup error", error.message);
  process.exit(1);
});

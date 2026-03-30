import { createMcpClient, listMcpTools } from "./src/mcp/client.js";
import { run } from "./src/agent.js";
import { nativeTools } from "./src/native/tools.js";
import { createSession, closeSession } from "./src/services/session-manager.js";
import { docs, task } from "./src/config.js";
import log from "./src/helpers/logger.js";
import { logStats } from "./src/helpers/stats.js";
import "./src/helpers/shutdown.js";

const AGENT_QUERY = `You are starting a new session for task "${task.name}".

Your objective: Build a valid SPK declaration for a shipment from ${task.from} to ${task.to}.

Shipment details:
- Sender ID: ${task.senderId}
- Weight: ${task.weightKg} kg
- Cargo: ${task.cargo}
- Budget: 0 PP (must be free or system-funded)

Start by fetching the documentation index from:
${docs.indexUrl}

Then explore all linked documents (including images), find the declaration template, extract route codes and transport rules, build a draft, render the declaration, and submit for verification.

Work step by step. Save everything to workspace. Update knowledge as you go.`;

const main = async () => {
  log.box("Sendit Declaration Agent\nSPK Transport System");

  let mcpClient;

  try {
    const session = await createSession();
    log.success(`Session: ${session.sessionId}`);

    log.start("Connecting to MCP server...");
    mcpClient = await createMcpClient();
    const mcpTools = await listMcpTools(mcpClient);
    log.success(`MCP tools: ${mcpTools.map((t) => t.name).join(", ")}`);
    log.success(`Native tools: ${nativeTools.map((t) => t.name).join(", ")}`);

    log.start("Starting documentation exploration and declaration building...");
    const result = await run(AGENT_QUERY, {
      mcpClient,
      mcpTools,
      sessionId: session.sessionId
    });

    log.success("Agent finished");
    log.response(result.response);

    await closeSession(session.sessionId, {
      success: true,
      response: result.response
    });

    logStats();
  } catch (error) {
    log.error("Agent error", error.message);
    throw error;
  } finally {
    if (mcpClient) {
      await mcpClient.close().catch(() => {});
    }
  }
};

main().catch((error) => {
  log.error("Startup error", error.message);
  logStats();
  process.exit(1);
});

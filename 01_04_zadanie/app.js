import { createMcpClient, listMcpTools } from "./src/mcp/client.js";
import { run } from "./src/agent.js";
import { nativeTools } from "./src/native/tools.js";
import { createSession, updateSession, closeSession } from "./src/services/session-manager.js";
import { createTracer } from "./src/services/trace-logger.js";
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

/**
 * After the agent finishes, scan the tracer events to populate
 * session.importantDecisions and session.verifyAttempts.
 */
const extractSessionInsights = (events) => {
  const decisions = [];
  const verifyAttempts = [];
  const validations = [];

  for (const evt of events) {
    if (evt.type === "verify.result") {
      verifyAttempts.push({
        timestamp: evt.timestamp,
        success: evt.data?.success,
        code: evt.data?.code,
        message: evt.data?.message,
      });
    }
    if (evt.type === "validation.result") {
      validations.push({
        timestamp: evt.timestamp,
        valid: evt.data?.valid,
        issues: evt.data?.issues,
      });
    }
    if (evt.type === "tool.update_knowledge.result") {
      decisions.push({
        timestamp: evt.timestamp,
        type: "knowledge_update",
        keys: evt.data?.updatedKeys,
      });
    }
    if (evt.type === "tool.render_declaration.result") {
      decisions.push({
        timestamp: evt.timestamp,
        type: "declaration_rendered",
        valid: evt.data?.valid,
      });
    }
  }

  return { importantDecisions: decisions, verifyAttempts, validations };
};

const main = async () => {
  log.box("Sendit Declaration Agent\nSPK Transport System");

  if (log.isVerbose()) {
    log.explain("Verbose mode ON", "Full tool args and outputs will be printed");
  }

  let mcpClient;
  let session;
  let tracer;

  try {
    session = await createSession();
    tracer = createTracer(session.sessionId);
    log.success(`Session: ${session.sessionId}`);
    log.explain("Trace file", tracer.path);

    tracer.record("app.start", {
      sessionId: session.sessionId,
      task: task.name,
      verbose: log.isVerbose(),
    });

    log.start("Connecting to MCP server...");
    mcpClient = await createMcpClient();
    const mcpTools = await listMcpTools(mcpClient);
    log.success(`MCP tools: ${mcpTools.map((t) => t.name).join(", ")}`);
    log.success(`Native tools: ${nativeTools.map((t) => t.name).join(", ")}`);

    const traceToolNames = [
      ...new Set([...mcpTools.map((t) => t.name), ...nativeTools.map((t) => t.name)])
    ].sort();
    tracer.setToolNames(traceToolNames);

    tracer.record("app.mcp_connected", {
      mcpTools: mcpTools.map(t => t.name),
      nativeTools: nativeTools.map(t => t.name),
    });

    log.start("Starting documentation exploration and declaration building...");
    const result = await run(AGENT_QUERY, {
      mcpClient,
      mcpTools,
      tracer,
    });

    log.success("Agent finished");
    log.response(result.response);

    const insights = extractSessionInsights(tracer.events);
    await updateSession(session.sessionId, {
      importantDecisions: insights.importantDecisions,
      verifyAttempts: insights.verifyAttempts,
      validations: insights.validations,
    });

    tracer.record("app.finish", {
      success: true,
      responsePreview: result.response.substring(0, 200),
      totalEvents: tracer.events.length,
    });

    await closeSession(session.sessionId, {
      success: true,
      response: result.response
    });

    const tracePath = await tracer.save();
    log.success(`Trace saved: ${tracePath}`);

    logStats();
  } catch (error) {
    log.error("Agent error", error.message);
    tracer?.record("app.error", { error: error.message, stack: error.stack });

    if (session) {
      await closeSession(session.sessionId, {
        success: false,
        error: error.message
      }).catch(() => {});
    }

    if (tracer) {
      await tracer.save().catch(() => {});
    }

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

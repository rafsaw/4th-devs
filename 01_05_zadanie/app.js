import { createMcpClient, listMcpTools } from "./src/mcp/client.js";
import { run } from "./src/agent.js";
import { nativeTools } from "./src/native/tools.js";
import { createSession, updateSession, closeSession } from "./src/services/session-manager.js";
import { createTracer } from "./src/services/trace-logger.js";
import { task } from "./src/config.js";
import log from "./src/helpers/logger.js";
import { logStats } from "./src/helpers/stats.js";
import "./src/helpers/shutdown.js";

const AGENT_QUERY = `You are starting a new session for verify task "${task.name}".

Objective: Activate railway route ${task.targetRoute} and obtain the final flag in format {FLG:...}.

The API self-documents. You MUST begin with a single railway_api_call whose answer includes the help action exactly as required (for this task: { "action": "help" }).

After that, only use actions and parameters discovered from help and subsequent responses. Persist important spec facts with railway_update_state. Use railway_list_recent_calls when comparing errors.

Minimize duplicate calls. When you receive the flag, output it clearly and stop.`;

/**
 * Mirror 01_04_zadanie: enrich session JSON from tracer events after the run.
 */
const extractSessionInsights = (events) => {
  const decisions = [];
  const verifyAttempts = [];
  const httpRetries = [];

  for (const evt of events) {
    if (evt.type === "verify.result") {
      verifyAttempts.push({
        timestamp: evt.timestamp,
        success: evt.data?.success,
        code: evt.data?.code,
        message: evt.data?.message,
        httpStatus: evt.data?.httpStatus,
        attempts: evt.data?.attempts,
      });
    }
    if (evt.type === "tool.railway_update_state.result") {
      decisions.push({
        timestamp: evt.timestamp,
        type: "railway_state_update",
        keys: evt.data?.keys,
      });
    }
    if (evt.type === "railway.http.backoff" || evt.type === "railway.http.attempt") {
      httpRetries.push({
        timestamp: evt.timestamp,
        type: evt.type,
        data: evt.data,
      });
    }
  }

  return {
    importantDecisions: decisions,
    verifyAttempts,
    httpRetries: httpRetries.slice(-30),
  };
};

const main = async () => {
  log.box("Railway verify agent\nAG3NTS task: railway");

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
      mcpToolCount: mcpTools.length,
      nativeToolCount: nativeTools.length,
    });

    log.start("Running spec-driven railway agent...");
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
      httpRetries: insights.httpRetries,
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

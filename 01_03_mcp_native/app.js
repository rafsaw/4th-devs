/**
 * MCP Native Demo — composition root for one agent using MCP + native tools.
 *
 * This file is the wiring layer: it starts the in-process MCP stack, discovers MCP
 * tools, merges them with locally defined native tools, builds the unified handler map
 * the agent uses for execution, and runs a small scripted query loop. The model only
 * sees a single tools[] list and cannot tell MCP-backed tools from native ones.
 *
 * Module overview (what this code does):
 * - Resolves model via resolveModelForProvider (root config.js) and sets system
 *   instructions for the demo.
 * - main(): createMcpServer + createMcpClient + listMcpTools to stand up MCP over
 *   InMemoryTransport in one Node process.
 * - handlers: Object.fromEntries merges (1) each MCP tool name → { execute: () =>
 *   callMcpTool(mcpClient, name, args), label: MCP_LABEL } and (2) each native tool from
 *   nativeHandlers → { execute: fn, label: NATIVE_LABEL }. Tool names in this map must
 *   match the names advertised to the model.
 * - tools: [...mcpToolsToOpenAI(mcpTools), ...nativeTools] — OpenAI Responses function
 *   definitions for both sources in one array passed to createAgent.
 * - createAgent({ model, tools, instructions, handlers }); iterate queries and
 *   agent.processQuery; then mcpClient.close() / mcpServer.close().
 *
 * Architecture (how it fits the stack):
 * - Sole place that imports mcp/server, mcp/client, native/tools, agent, and ties them
 *   together. agent.js and ai.js stay generic; this file encodes the demo’s topology
 *   (co-located MCP, which native tools exist, handler labels for display).
 * - The dual structure (tools for the LLM + handlers for execution) is intentional:
 *   schemas come from MCP/native modules; dispatch is a plain JS map keyed by name.
 *
 * Production considerations:
 * - This entrypoint is a CLI-style demo (fixed queries, console output). A real service
 *   would expose HTTP/WebSocket, authenticate users, scope tools per tenant, and drive
 *   processQuery from requests instead of a hardcoded array.
 * - Model, provider, and API keys should come from configuration and secret stores, not
 *   literals; instructions may be per-customer or per-session.
 * - Lifecycle: here MCP starts once per process; in production you might create MCP
 *   clients per request, pool them, or connect to remote MCP servers—close()/shutdown
 *   must match that pattern to avoid leaks.
 * - In-memory MCP does not span hosts; distributed setups point the MCP client at remote
 *   transports and may run the agent in a separate deployable from the MCP server.
 * - Error handling is main().catch(console.error); production needs structured errors,
 *   retries at the right layer, and health checks.
 * - Verify every tool name in tools[] has a matching key in handlers before serving
 *   traffic; mismatches surface as runtime failures inside the agent loop.
 */

import { createMcpServer } from "./src/mcp/server.js";
import { createMcpClient, listMcpTools, mcpToolsToOpenAI, callMcpTool } from "./src/mcp/client.js";
import { nativeTools, nativeHandlers } from "./src/native/tools.js";
import { createAgent } from "./src/agent.js";
import { MCP_LABEL, NATIVE_LABEL } from "./src/log.js";
import { resolveModelForProvider } from "../config.js";

const model = resolveModelForProvider("openai/gpt-4.1-mini");
const instructions = `You are a helpful assistant with access to various tools.
You can check weather, get time, perform calculations, and transform text.
Use the appropriate tool for each task. Be concise.`;

const main = async () => {
  // Start in-memory MCP server and connect a client
  const mcpServer = createMcpServer();
  const mcpClient = await createMcpClient(mcpServer);
  const mcpTools = await listMcpTools(mcpClient);

  // Unified handler map — MCP and native tools behind the same { execute, label } interface
  const handlers = Object.fromEntries([
    ...mcpTools.map((t) => [t.name, {
      execute: (args) => callMcpTool(mcpClient, t.name, args),
      label: MCP_LABEL
    }]),
    ...Object.entries(nativeHandlers).map(([name, fn]) => [name, {
      execute: fn,
      label: NATIVE_LABEL
    }])
  ]);

  const tools = [...mcpToolsToOpenAI(mcpTools), ...nativeTools];

  const agent = createAgent({ model, tools, instructions, handlers });
 


  console.log(`MCP tools: ${mcpTools.map((t) => t.name).join(", ")}`);
  console.log(`Native tools: ${Object.keys(nativeHandlers).join(", ")}`);

  const queries = [
     "What's the weather in Tokyo?"
    //  "What time is it in Europe/London?"
    // "Calculate 42 multiplied by 17",
    // "Convert 'hello world' to uppercase"
    // "What's 25 + 17, and what's the weather in Paris?"
  ];

  for (const query of queries) {
    const answer = await agent.processQuery(query);
    console.log(answer);
  }

  await mcpClient.close();
  await mcpServer.close();
};

main().catch(console.error);

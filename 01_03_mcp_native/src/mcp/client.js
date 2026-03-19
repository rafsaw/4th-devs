/**
 * MCP client — connects to a server via in-memory transport.
 *
 * In-memory transport is used here because the server runs in the same
 * process (unlike mcp_core which uses stdio for a subprocess).
 * The wrapper functions bridge MCP tool format to OpenAI function format
 * so the agent can treat MCP tools like any other tool.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

export const createMcpClient = async (server, { tracer } = {}) => {
  const client = new Client(
    { name: "demo-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );
  // tracer?.record("mcp-client.startup", {
  //   name: "demo-mcp-client",
  //   version: "1.0.0",
  // });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // tracer?.record("mcp-client.transport.linked", {
  //   clientTransportType: clientTransport.constructor?.name,
  //   serverTransportType: serverTransport.constructor?.name,
  // });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  // tracer?.record("mcp-client.client.connected", {
  //   clientInfo: { name: "demo-mcp-client", version: "1.0.0" },
  //   serverInfo: { name: "demo-mcp-server", version: "1.0.0" },
  // });

  return client;
};

export const listMcpTools = async (client, { tracer } = {}) => {
  // tracer?.record("mcp-client.tools.list.request");

  const { tools } = await client.listTools();

  // tracer?.record("mcp-client.tools.list.response", { tools });

  return tools;
};

// Calls an MCP tool and parses the text result
export const callMcpTool = async (client, name, args, { tracer } = {}) => {
  // tracer?.record("mcp-client.tool.call.request", { name, arguments: args });

  const result = await client.callTool({ name, arguments: args });

  // tracer?.record("mcp-client.tool.call.response", { name, rawResult: result });

  const textContent = result.content.find((c) => c.type === "text");
  return textContent ? JSON.parse(textContent.text) : result;
};

// Converts MCP tool schemas → OpenAI function-calling format
export const mcpToolsToOpenAI = (mcpTools, { tracer } = {}) => {
  const openAITools = mcpTools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: true
  }));
  // tracer?.record("mcp-client.tools.converted.to_openai", {
  //   count: openAITools.length,
  //   tools: openAITools.map((t) => ({ name: t.name, description: t.description })),
  // });
  return openAITools;
};

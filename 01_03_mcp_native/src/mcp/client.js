/**
 * MCP client — connects to a server via in-memory transport (demo).
 *
 * In-memory transport is used here because the server runs in the same Node process
 * (unlike mcp_core which uses stdio for a subprocess). The exports below wrap the
 * @modelcontextprotocol/sdk Client so the rest of the app can discover tools, invoke
 * them, and feed tool schemas into the LLM as OpenAI-style function tools.
 *
 * Module overview (what this code does):
 * - createMcpClient: constructs SDK Client, creates InMemoryTransport.createLinkedPair(),
 *   connects the McpServer to one side and the Client to the other. That establishes
 *   an MCP session with no network I/O—JSON-RPC messages (e.g. tools/list, tools/call)
 *   are delivered in-process.
 * - listMcpTools: calls Client.listTools() → MCP tools/list. Returns the server’s tool
 *   catalog (name, description, inputSchema, …). The client does not define tools; it
 *   only asks the server what exists.
 * - callMcpTool: calls Client.callTool() → MCP tools/call with name + JSON arguments.
 *   The server runs the handler and returns CallToolResult; this helper pulls the first
 *   text content part and JSON.parse’s it for the agent (demo convention).
 * - mcpToolsToOpenAI: pure adapter from MCP tool definitions to OpenAI function-calling
 *   tool objects (type, name, description, parameters, strict) so Responses/chat APIs
 *   and the agent loop can merge MCP tools with native in-app tools.
 *
 * MCP architecture (role of the client):
 * - The client is the caller: it issues tools/list and tools/call. It does not execute
 *   tool business logic; the server does. The client’s job is discovery, invocation,
 *   and (here) bridging results/schemas into your LLM stack.
 * - Transport is swappable: production often uses Streamable HTTP/SSE to a remote MCP
 *   server, or stdio to a local MCP subprocess—the SDK Client API stays similar;
 *   only connect() wiring changes.
 *
 * Production deployment — where does the MCP client live?
 * - Typical: inside the same backend that runs your agent (“host app”)—e.g. a Node
 *   service that calls the LLM, holds conversation state, and instantiates one or more
 *   MCP clients to talk to MCP servers (remote HTTP, local child process, or in-proc
 *   for tests). The model never speaks MCP; your service uses MCP on the model’s behalf.
 * - Optional: a dedicated “tool gateway” API service that owns all MCP clients and
 *   exposes a simpler HTTP API to the rest of your platform. Useful for central auth
 *   or isolating untrusted MCP servers; adds a hop and operational complexity.
 * - Browsers usually should not be raw MCP clients to arbitrary third-party servers
 *   without strong controls (credentials, capability review, CORS/proxy). Often the
 *   browser talks only to your API, and your API is the MCP client.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

export const createMcpClient = async (server) => {
  const client = new Client(
    { name: "demo-mcp-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
};

export const listMcpTools = async (client) => {
  // @modelcontextprotocol/sdk Client.listTools(): sends MCP tools/list over the connected transport.
  // Here that transport is InMemoryTransport (same process as createMcpClient): the client asks the
  // MCP server for tool definitions; the server responds with registered tools (name, description,
  // inputSchema, …) per the MCP spec.
  const { tools } = await client.listTools();
  return tools;
};

// Calls an MCP tool and parses the text result
export const callMcpTool = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });

  const textContent = result.content.find((c) => c.type === "text");
  return textContent ? JSON.parse(textContent.text) : result;
};

// Converts MCP tool schemas → OpenAI function-calling format
export const mcpToolsToOpenAI = (mcpTools) => {
  return mcpTools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: true
  }));
};

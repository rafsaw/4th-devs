/**
 * In-memory MCP server with mock tools (weather, time).
 *
 * Unlike mcp_core which uses stdio transport, this server runs
 * in the same process and connects via InMemoryTransport.
 * The tools are intentionally simple — the point of this example
 * is the unified agent loop, not the tool implementations.
 *
 * Module overview:
 * - Builds an MCP Server (SDK McpServer) in the same Node process as the client (InMemoryTransport).
 * - Each registerTool() adds a tool definition (name, description, Zod/input schema) on the server.
 * - The client discovers those definitions via MCP tools/list; the server returns the catalog, so the
 *   server is the source of truth for which tools exist and their shapes.
 * - On tools/call, the matching async handler below runs on this server: the server advertises and
 *   executes tools; the client only invokes and does not run business logic.
 * - get_weather uses random fake data for teaching; get_time uses Date/toLocaleString (real clock,
 *   no external weather API).
 * - In production, handlers typically await fetch(), databases, internal services, queues, etc.—MCP
 *   is the RPC boundary; tool bodies are normal async I/O.
 *
 * Production architecture (where business logic lives):
 * - The MCP server process still needs code that handles tools/call, validates arguments against
 *   each tool schema, and returns a valid MCP tool result (content blocks, optional isError, etc.).
 *   That envelope is required by the protocol.
 * - Often the server is a thin adapter: validate inputs, call an HTTP/gRPC/internal API or database,
 *   then map the service response into MCP content (e.g. JSON in a text part). The downstream
 *   service usually does not speak MCP; it uses its own contract.
 * - Something at the MCP boundary must produce MCP-shaped results. Typically the MCP layer maps
 *   backend payloads into that format rather than expecting backends to return MCP-native messages
 *   unless you deliberately design that way.
 * - Smaller deployments may put DB/API calls directly inside registerTool handlers (monolith MCP
 *   server); that is still valid production—MCP is the RPC edge, tool bodies are normal async I/O.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const createMcpServer = () => {
  const server = new McpServer(
    { name: "demo-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "get_weather",
    {
      description: "Get current weather for a city",
      inputSchema: { city: z.string().describe("City name") }
    },
    async ({ city }) => {
      const conditions = ["sunny", "cloudy", "rainy", "snowy"];
      const condition = conditions[Math.floor(Math.random() * conditions.length)];
      const temp = Math.floor(Math.random() * 35) - 5;

      return {
        content: [
          { type: "text", text: JSON.stringify({ city, condition, temperature: `${temp}°C` }) }
        ]
      };
    }
  );

  server.registerTool(
    "get_time",
    {
      description: "Get current time in a specified timezone",
      inputSchema: { timezone: z.string().describe("Timezone (e.g., 'UTC', 'America/New_York')") }
    },
    async ({ timezone }) => {
      try {
        const time = new Date().toLocaleString("en-US", { timeZone: timezone });
        return {
          content: [{ type: "text", text: JSON.stringify({ timezone, time }) }]
        };
      } catch {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Invalid timezone: ${timezone}` }) }],
          isError: true
        };
      }
    }
  );

  return server;
};

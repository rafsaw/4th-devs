/**
 * In-memory MCP server with mock tools (weather, time).
 *
 * Unlike mcp_core which uses stdio transport, this server runs
 * in the same process and connects via InMemoryTransport.
 * The tools are intentionally simple — the point of this example
 * is the unified agent loop, not the tool implementations.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const createMcpServer = ({ tracer } = {}) => {
  const server = new McpServer(
    { name: "demo-mcp-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  // tracer?.record("mcp-server.startup", {
  //   name: "demo-mcp-server",
  //   version: "1.0.0",
  // });

  server.registerTool(
    "get_weather",
    {
      description: "Get current weather for a city",
      inputSchema: { city: z.string().describe("City name") }
    },
    async ({ city }) => {
      tracer?.record("mcp-server.tool.handler.invoke", {
        name: "get_weather",
        args: { city },
      });

      const conditions = ["sunny", "cloudy", "rainy", "snowy"];
      const condition = conditions[Math.floor(Math.random() * conditions.length)];
      const temp = Math.floor(Math.random() * 35) - 5;

      const response = {
        content: [{ type: "text", text: JSON.stringify({ city, condition, temperature: `${temp}°C` }) }]
      };

      tracer?.record("mcp-server.tool.handler.result", {
        name: "get_weather",
        response,
      });

      return response;
    }
  );

  server.registerTool(
    "get_time",
    {
      description: "Get current time in a specified timezone",
      inputSchema: { timezone: z.string().describe("Timezone (e.g., 'UTC', 'America/New_York')") }
    },
    async ({ timezone }) => {
      tracer?.record("mcp-server.tool.handler.invoke", {
        name: "get_time",
        args: { timezone },
      });

      try {
        const time = new Date().toLocaleString("en-US", { timeZone: timezone });
        const response = {
          content: [{ type: "text", text: JSON.stringify({ timezone, time }) }]
        };
        tracer?.record("mcp-server.tool.handler.result", {
          name: "get_time",
          response,
        });

        return response;
      } catch {
        const errorResponse = {
          content: [{ type: "text", text: JSON.stringify({ error: `Invalid timezone: ${timezone}` }) }],
          isError: true
        };
        tracer?.record("mcp-server.tool.handler.error", {
          name: "get_time",
          response: errorResponse,
        });

        return errorResponse;
      }
    }
  );

  return server;
};

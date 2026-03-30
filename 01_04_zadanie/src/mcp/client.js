import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import log from "../helpers/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

const loadMcpConfig = async () => {
  const configPath = join(PROJECT_ROOT, "mcp.json");
  const content = await readFile(configPath, "utf-8");
  return JSON.parse(content);
};

export const createMcpClient = async (serverName = "files") => {
  const config = await loadMcpConfig();
  const serverConfig = config.mcpServers[serverName];

  if (!serverConfig) {
    throw new Error(`MCP server "${serverName}" not found in mcp.json`);
  }

  const client = new Client(
    { name: "sendit-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  log.info(`Spawning MCP server: ${serverName}`);
  log.info(`Command: ${serverConfig.command} ${serverConfig.args.join(" ")}`);

  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
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

export const listMcpTools = async (client) => {
  const result = await client.listTools();
  return result.tools;
};

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

export const mcpToolsToOpenAI = (mcpTools) =>
  mcpTools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false
  }));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { toolRegistrations } from "./tools.js";

const SERVER_NAME = "photo-get-skill";
const SERVER_VERSION = "1.1.0";

const mcpServer = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

for (const tool of toolRegistrations) {
  mcpServer.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.inputSchema,
  }, tool.handler);
}

process.on("uncaughtException", (error) => {
  console.error(`[${SERVER_NAME}] uncaughtException:`, error);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${SERVER_NAME}] unhandledRejection:`, reason);
});

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(`[${SERVER_NAME}] MCP server ready`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

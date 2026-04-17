import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KeychainProvider } from "./providers/keychain.js";
import { registerListTool } from "./tools/list.js";
import { registerGetRefTool } from "./tools/get-ref.js";
import { registerSetTool } from "./tools/set.js";
import { registerResolveTool } from "./tools/resolve.js";

const server = new McpServer({
  name: "vaultsmith",
  version: "0.1.0",
});

const provider = new KeychainProvider();

registerListTool(server, provider);
registerGetRefTool(server, provider);
registerSetTool(server, provider);
registerResolveTool(server, provider);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Vaultsmith MCP server failed to start:", err);
  process.exit(1);
});

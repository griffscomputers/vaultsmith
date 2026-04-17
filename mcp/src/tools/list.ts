import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VaultProvider } from "../providers/interface.js";

export function registerListTool(server: McpServer, provider: VaultProvider) {
  server.tool(
    "vault_list",
    "List secret references in the vault. Returns names and metadata, never values.",
    { prefix: z.string().optional().describe("Filter secrets by name prefix") },
    async ({ prefix }) => {
      const secrets = await provider.list(prefix);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(secrets, null, 2),
          },
        ],
      };
    }
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VaultProvider } from "../providers/interface.js";

export function registerSetTool(server: McpServer, provider: VaultProvider) {
  server.tool(
    "vault_set",
    "Store a secret in the vault. The value will be encrypted at rest in the OS keychain.",
    {
      name: z.string().describe("Secret name (e.g., aws/dev/access_key)"),
      value: z.string().describe("The secret value to store"),
      tags: z.record(z.string()).optional().describe("Optional key-value tags"),
    },
    async ({ name, value, tags }) => {
      await provider.set(name, value, tags);
      const ref = await provider.getRef(name);
      return {
        content: [
          {
            type: "text" as const,
            text: `Secret stored. Reference: ${ref}`,
          },
        ],
      };
    }
  );
}

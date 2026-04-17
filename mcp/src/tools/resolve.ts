import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VaultProvider } from "../providers/interface.js";

export function registerResolveTool(server: McpServer, provider: VaultProvider) {
  server.tool(
    "vault_resolve",
    "Resolve a vsm:// reference to its plaintext value. SENSITIVE: This returns the actual secret. Requires user approval. Only use when the secret value must be passed to a running process.",
    {
      ref: z.string().describe("The vsm:// reference to resolve (e.g., vsm://aws/dev/access_key)"),
      justification: z.string().describe("Why this secret needs to be resolved (shown to the user for approval)"),
    },
    async ({ ref, justification }) => {
      const value = await provider.resolve(ref);
      return {
        content: [
          {
            type: "text" as const,
            text: value,
          },
        ],
      };
    }
  );
}

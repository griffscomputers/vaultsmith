import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { VaultProvider } from "../providers/interface.js";

export function registerGetRefTool(server: McpServer, provider: VaultProvider) {
  server.tool(
    "vault_get_ref",
    "Get the vsm:// reference URI for a secret. Returns the reference, never the plaintext value.",
    { name: z.string().describe("The secret name to get a reference for") },
    async ({ name }) => {
      const ref = await provider.getRef(name);
      return {
        content: [{ type: "text" as const, text: ref }],
      };
    }
  );
}

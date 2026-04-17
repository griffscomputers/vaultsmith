"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerListTool = registerListTool;
const zod_1 = require("zod");
function registerListTool(server, provider) {
    server.tool("vault_list", "List secret references in the vault. Returns names and metadata, never values.", { prefix: zod_1.z.string().optional().describe("Filter secrets by name prefix") }, async ({ prefix }) => {
        const secrets = await provider.list(prefix);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(secrets, null, 2),
                },
            ],
        };
    });
}

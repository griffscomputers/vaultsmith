"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSetTool = registerSetTool;
const zod_1 = require("zod");
function registerSetTool(server, provider) {
    server.tool("vault_set", "Store a secret in the vault. The value will be encrypted at rest in the OS keychain.", {
        name: zod_1.z.string().describe("Secret name (e.g., aws/dev/access_key)"),
        value: zod_1.z.string().describe("The secret value to store"),
        tags: zod_1.z.record(zod_1.z.string()).optional().describe("Optional key-value tags"),
    }, async ({ name, value, tags }) => {
        await provider.set(name, value, tags);
        const ref = await provider.getRef(name);
        return {
            content: [
                {
                    type: "text",
                    text: `Secret stored. Reference: ${ref}`,
                },
            ],
        };
    });
}

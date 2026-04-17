"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerResolveTool = registerResolveTool;
const zod_1 = require("zod");
function registerResolveTool(server, provider) {
    server.tool("vault_resolve", "Resolve a vsm:// reference to its plaintext value. SENSITIVE: This returns the actual secret. Requires user approval. Only use when the secret value must be passed to a running process.", {
        ref: zod_1.z.string().describe("The vsm:// reference to resolve (e.g., vsm://aws/dev/access_key)"),
        justification: zod_1.z.string().describe("Why this secret needs to be resolved (shown to the user for approval)"),
    }, async ({ ref, justification }) => {
        const value = await provider.resolve(ref);
        return {
            content: [
                {
                    type: "text",
                    text: value,
                },
            ],
        };
    });
}

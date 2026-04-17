"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGetRefTool = registerGetRefTool;
const zod_1 = require("zod");
function registerGetRefTool(server, provider) {
    server.tool("vault_get_ref", "Get the vsm:// reference URI for a secret. Returns the reference, never the plaintext value.", { name: zod_1.z.string().describe("The secret name to get a reference for") }, async ({ name }) => {
        const ref = await provider.getRef(name);
        return {
            content: [{ type: "text", text: ref }],
        };
    });
}

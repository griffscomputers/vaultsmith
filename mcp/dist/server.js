"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const keychain_js_1 = require("./providers/keychain.js");
const list_js_1 = require("./tools/list.js");
const get_ref_js_1 = require("./tools/get-ref.js");
const set_js_1 = require("./tools/set.js");
const resolve_js_1 = require("./tools/resolve.js");
const server = new mcp_js_1.McpServer({
    name: "vaultsmith",
    version: "0.1.0",
});
const provider = new keychain_js_1.KeychainProvider();
(0, list_js_1.registerListTool)(server, provider);
(0, get_ref_js_1.registerGetRefTool)(server, provider);
(0, set_js_1.registerSetTool)(server, provider);
(0, resolve_js_1.registerResolveTool)(server, provider);
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error("Vaultsmith MCP server failed to start:", err);
    process.exit(1);
});

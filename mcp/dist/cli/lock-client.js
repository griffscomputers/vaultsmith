"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_net_1 = __importDefault(require("node:net"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const socket_path_js_1 = require("./socket-path.js");
function send(sockPath, payload) {
    return new Promise((resolve) => {
        const conn = node_net_1.default.createConnection(sockPath);
        let buf = "";
        let resolved = false;
        const finish = (resp) => {
            if (resolved)
                return;
            resolved = true;
            try {
                conn.end();
            }
            catch {
                // ignore
            }
            resolve(resp);
        };
        conn.on("connect", () => {
            conn.write(JSON.stringify(payload) + "\n");
        });
        conn.on("data", (chunk) => {
            buf += chunk.toString("utf8");
            const idx = buf.indexOf("\n");
            if (idx >= 0) {
                try {
                    finish(JSON.parse(buf.slice(0, idx)));
                }
                catch {
                    finish({ ok: false, error: "bad response" });
                }
            }
        });
        conn.on("error", (err) => {
            finish({ ok: false, error: err.message });
        });
        conn.on("close", () => {
            if (!resolved)
                finish({ ok: false, error: "closed before response" });
        });
    });
}
function listSockets() {
    const dir = (0, socket_path_js_1.socketDir)();
    if (!node_fs_1.default.existsSync(dir))
        return [];
    return node_fs_1.default
        .readdirSync(dir)
        .filter((f) => f.endsWith(".sock"))
        .map((f) => node_path_1.default.join(dir, f));
}
async function lockAll() {
    const sockets = listSockets();
    if (sockets.length === 0) {
        console.log("vault-lock: no active daemons");
        return;
    }
    for (const sockPath of sockets) {
        const resp = await send(sockPath, { op: "lock" });
        const name = node_path_1.default.basename(sockPath);
        if (resp.ok) {
            console.log(`vault-lock: locked ${name}`);
        }
        else {
            console.log(`vault-lock: ${name}: ${resp.error}`);
            // Clean stale socket files
            try {
                node_fs_1.default.unlinkSync(sockPath);
            }
            catch {
                // ignore
            }
        }
    }
}
async function lockOne() {
    const anchor = (0, socket_path_js_1.anchorFromEnv)() ?? { kind: "pid", pid: process.ppid };
    const sockPath = (0, socket_path_js_1.socketPathFor)(anchor);
    if (!node_fs_1.default.existsSync(sockPath)) {
        console.log("vault-lock: no active daemon for this session");
        return;
    }
    const resp = await send(sockPath, { op: "lock" });
    if (resp.ok) {
        console.log("vault-lock: locked");
    }
    else {
        console.log(`vault-lock: ${resp.error}`);
    }
}
async function status() {
    const sockets = listSockets();
    if (sockets.length === 0) {
        console.log("vault-status: no active daemons");
        return;
    }
    console.log(`vault-status: ${sockets.length} daemon(s)`);
    for (const sockPath of sockets) {
        const name = node_path_1.default.basename(sockPath);
        const resp = await send(sockPath, { op: "status" });
        if (resp.ok) {
            console.log(`  ${name}: cached=${resp.cached} idle=${resp.idle_sec}s uptime=${resp.uptime_sec}s anchor=${resp.anchor}`);
        }
        else {
            console.log(`  ${name}: ${resp.error}`);
        }
    }
}
async function main() {
    const args = process.argv.slice(2);
    if (args.includes("--status")) {
        await status();
    }
    else if (args.includes("--all")) {
        await lockAll();
    }
    else {
        await lockOne();
    }
}
main().catch((err) => {
    console.error("lock-client error:", err.message);
    process.exit(1);
});

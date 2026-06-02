"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_net_1 = __importDefault(require("node:net"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const socket_path_js_1 = require("./socket-path.js");
const daemonPath = node_path_1.default.join(__dirname, "session-daemon.js");
function startDaemon(anchor) {
    const args = anchor.kind === "tty"
        ? ["--tty", anchor.tty]
        : anchor.label
            ? ["--pid", String(anchor.pid), "--label", anchor.label]
            : ["--pid", String(anchor.pid)];
    const child = (0, node_child_process_1.spawn)(process.execPath, [daemonPath, ...args], {
        detached: true,
        stdio: "ignore",
    });
    child.unref();
}
async function waitForSocket(sockPath, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (node_fs_1.default.existsSync(sockPath))
            return;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`daemon socket did not appear: ${sockPath}`);
}
function send(sockPath, payload) {
    return new Promise((resolve, reject) => {
        const conn = node_net_1.default.createConnection(sockPath);
        let buf = "";
        conn.on("connect", () => {
            conn.write(JSON.stringify(payload) + "\n");
        });
        conn.on("data", (chunk) => {
            buf += chunk.toString("utf8");
            const idx = buf.indexOf("\n");
            if (idx >= 0) {
                try {
                    resolve(JSON.parse(buf.slice(0, idx)));
                }
                catch (e) {
                    reject(e);
                }
                conn.end();
            }
        });
        conn.on("error", reject);
    });
}
function fallbackAnchor() {
    const ppid = process.ppid;
    return { kind: "pid", pid: ppid };
}
async function main() {
    const name = process.argv[2];
    if (!name) {
        console.error("usage: resolve-client <name>");
        process.exit(2);
    }
    const anchor = (0, socket_path_js_1.anchorFromEnv)() ?? fallbackAnchor();
    const sockPath = (0, socket_path_js_1.socketPathFor)(anchor);
    if (!node_fs_1.default.existsSync(sockPath)) {
        startDaemon(anchor);
        await waitForSocket(sockPath);
    }
    let resp;
    try {
        resp = await send(sockPath, { op: "resolve", name });
    }
    catch (err) {
        const code = err.code;
        if (code === "ECONNREFUSED" || code === "ENOENT") {
            try {
                node_fs_1.default.unlinkSync(sockPath);
            }
            catch {
                // not present
            }
            startDaemon(anchor);
            await waitForSocket(sockPath);
            resp = await send(sockPath, { op: "resolve", name });
        }
        else {
            throw err;
        }
    }
    if (!resp.ok || resp.value === undefined) {
        console.error(`resolve failed: ${resp.error ?? "unknown"}`);
        process.exit(1);
    }
    process.stdout.write(resp.value);
}
main().catch((err) => {
    console.error("resolve-client error:", err.message);
    process.exit(1);
});

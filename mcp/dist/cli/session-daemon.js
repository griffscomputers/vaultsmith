"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_net_1 = __importDefault(require("node:net"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const keychain_js_1 = require("../providers/keychain.js");
const socket_path_js_1 = require("./socket-path.js");
const IDLE_MS = 30 * 60 * 1000;
const ANCHOR_CHECK_MS = 5_000;
const IDLE_CHECK_MS = 60_000;
function parseArgs() {
    const args = process.argv.slice(2);
    let kind = null;
    let tty = null;
    let pid = null;
    let label;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--tty") {
            kind = "tty";
            tty = args[i + 1];
            i++;
        }
        else if (args[i] === "--pid") {
            kind = "pid";
            pid = parseInt(args[i + 1], 10);
            i++;
        }
        else if (args[i] === "--label") {
            label = args[i + 1];
            i++;
        }
    }
    if (kind === "tty" && tty)
        return { kind, tty };
    if (kind === "pid" && pid && Number.isFinite(pid))
        return label ? { kind, pid, label } : { kind, pid };
    throw new Error("session-daemon: missing --tty <path> or --pid <pid>");
}
function anchorAlive(anchor) {
    try {
        if (anchor.kind === "tty") {
            node_fs_1.default.statSync(anchor.tty);
            return true;
        }
        process.kill(anchor.pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function anchorLabel(anchor) {
    return anchor.kind === "tty"
        ? anchor.tty
        : `pid:${anchor.pid}${anchor.label ? `:${anchor.label}` : ""}`;
}
async function main() {
    const anchor = parseArgs();
    const dir = (0, socket_path_js_1.socketDir)();
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    try {
        node_fs_1.default.chmodSync(dir, 0o700);
    }
    catch {
        // best-effort
    }
    const sockPath = (0, socket_path_js_1.socketPathFor)(anchor);
    try {
        node_fs_1.default.unlinkSync(sockPath);
    }
    catch {
        // not present
    }
    const provider = new keychain_js_1.KeychainProvider();
    const cache = new Map();
    let lastAccess = Date.now();
    const startTime = Date.now();
    const logPath = node_path_1.default.join(dir, "daemon.log");
    const log = (msg) => {
        try {
            node_fs_1.default.appendFileSync(logPath, `[${new Date().toISOString()}] [${anchorLabel(anchor)}] ${msg}\n`, { mode: 0o600 });
        }
        catch {
            // best-effort
        }
    };
    let shuttingDown = false;
    const shutdown = (reason) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        log(`shutdown: ${reason}`);
        for (const buf of cache.values()) {
            buf.fill(0);
        }
        cache.clear();
        try {
            node_fs_1.default.unlinkSync(sockPath);
        }
        catch {
            // best-effort
        }
        process.exit(0);
    };
    process.on("SIGHUP", () => shutdown("SIGHUP"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    const server = node_net_1.default.createServer((conn) => {
        let buf = "";
        conn.on("data", async (chunk) => {
            buf += chunk.toString("utf8");
            let idx;
            while ((idx = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 1);
                let req;
                try {
                    req = JSON.parse(line);
                }
                catch {
                    conn.write(JSON.stringify({ ok: false, error: "bad json" }) + "\n");
                    continue;
                }
                try {
                    if (req.op === "resolve") {
                        lastAccess = Date.now();
                        const name = String(req.name || "");
                        if (!name) {
                            conn.write(JSON.stringify({ ok: false, error: "missing name" }) + "\n");
                            continue;
                        }
                        let value;
                        const cached = cache.get(name);
                        if (cached) {
                            value = cached.toString("utf8");
                            log(`resolve hit: ${name}`);
                        }
                        else {
                            log(`resolve miss: ${name} — calling keychain`);
                            value = await provider.resolve(`vsm://${name}`);
                            cache.set(name, Buffer.from(value, "utf8"));
                        }
                        conn.write(JSON.stringify({ ok: true, value }) + "\n");
                    }
                    else if (req.op === "lock") {
                        log("lock requested");
                        conn.write(JSON.stringify({ ok: true }) + "\n");
                        conn.end();
                        setImmediate(() => shutdown("lock"));
                    }
                    else if (req.op === "status") {
                        const idle = Math.floor((Date.now() - lastAccess) / 1000);
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        conn.write(JSON.stringify({
                            ok: true,
                            cached: cache.size,
                            idle_sec: idle,
                            uptime_sec: uptime,
                            anchor: anchorLabel(anchor),
                        }) + "\n");
                    }
                    else {
                        conn.write(JSON.stringify({ ok: false, error: `unknown op: ${req.op}` }) +
                            "\n");
                    }
                }
                catch (err) {
                    const msg = err.message;
                    log(`error: ${msg}`);
                    conn.write(JSON.stringify({ ok: false, error: msg }) + "\n");
                }
            }
        });
        conn.on("error", () => {
            // client disconnects are expected
        });
    });
    server.listen(sockPath, () => {
        try {
            node_fs_1.default.chmodSync(sockPath, 0o600);
        }
        catch {
            // best-effort
        }
        log(`listening on ${sockPath}`);
    });
    setInterval(() => {
        if (!anchorAlive(anchor)) {
            shutdown("anchor gone");
        }
    }, ANCHOR_CHECK_MS).unref();
    setInterval(() => {
        if (Date.now() - lastAccess > IDLE_MS) {
            shutdown("idle timeout");
        }
    }, IDLE_CHECK_MS).unref();
}
main().catch((err) => {
    console.error("session-daemon fatal:", err);
    process.exit(1);
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketDir = socketDir;
exports.socketPathFor = socketPathFor;
exports.anchorFromEnv = anchorFromEnv;
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
function socketDir() {
    const uid = typeof process.getuid === "function"
        ? process.getuid()
        : (0, node_os_1.userInfo)().uid;
    return `/tmp/vaultsmith-${uid}`;
}
function socketPathFor(anchor) {
    if (anchor.kind === "tty") {
        const sanitized = anchor.tty
            .replace(/^\/dev\//, "")
            .replace(/[^a-zA-Z0-9]/g, "_");
        return (0, node_path_1.join)(socketDir(), `tty-${sanitized}.sock`);
    }
    return (0, node_path_1.join)(socketDir(), `pid-${anchor.pid}.sock`);
}
function anchorFromEnv() {
    const tty = process.env.VAULTSMITH_ANCHOR_TTY;
    if (tty) {
        return { kind: "tty", tty };
    }
    const pidStr = process.env.VAULTSMITH_ANCHOR_PID;
    if (pidStr) {
        const pid = parseInt(pidStr, 10);
        if (Number.isFinite(pid) && pid > 1) {
            const label = process.env.VAULTSMITH_ANCHOR_LABEL;
            return label ? { kind: "pid", pid, label } : { kind: "pid", pid };
        }
    }
    return null;
}

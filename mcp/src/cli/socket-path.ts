import { userInfo } from "node:os";
import { join } from "node:path";

export type Anchor =
  | { kind: "tty"; tty: string }
  | { kind: "pid"; pid: number; label?: string };

export function socketDir(): string {
  const uid =
    typeof process.getuid === "function"
      ? process.getuid()
      : userInfo().uid;
  return `/tmp/vaultsmith-${uid}`;
}

export function socketPathFor(anchor: Anchor): string {
  if (anchor.kind === "tty") {
    const sanitized = anchor.tty
      .replace(/^\/dev\//, "")
      .replace(/[^a-zA-Z0-9]/g, "_");
    return join(socketDir(), `tty-${sanitized}.sock`);
  }
  return join(socketDir(), `pid-${anchor.pid}.sock`);
}

export function anchorFromEnv(): Anchor | null {
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

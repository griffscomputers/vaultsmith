import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Anchor, anchorFromEnv, socketPathFor } from "./socket-path.js";

const daemonPath = path.join(__dirname, "session-daemon.js");

function startDaemon(anchor: Anchor): void {
  const args =
    anchor.kind === "tty"
      ? ["--tty", anchor.tty]
      : anchor.label
        ? ["--pid", String(anchor.pid), "--label", anchor.label]
        : ["--pid", String(anchor.pid)];
  const child = spawn(process.execPath, [daemonPath, ...args], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function waitForSocket(
  sockPath: string,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(sockPath)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`daemon socket did not appear: ${sockPath}`);
}

function send(
  sockPath: string,
  payload: object
): Promise<{ ok: boolean; value?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(sockPath);
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
        } catch (e) {
          reject(e);
        }
        conn.end();
      }
    });
    conn.on("error", reject);
  });
}

function fallbackAnchor(): Anchor {
  const ppid = process.ppid;
  return { kind: "pid", pid: ppid };
}

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error("usage: resolve-client <name>");
    process.exit(2);
  }

  const anchor = anchorFromEnv() ?? fallbackAnchor();
  const sockPath = socketPathFor(anchor);

  if (!fs.existsSync(sockPath)) {
    startDaemon(anchor);
    await waitForSocket(sockPath);
  }

  let resp: { ok: boolean; value?: string; error?: string };
  try {
    resp = await send(sockPath, { op: "resolve", name });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ECONNREFUSED" || code === "ENOENT") {
      try {
        fs.unlinkSync(sockPath);
      } catch {
        // not present
      }
      startDaemon(anchor);
      await waitForSocket(sockPath);
      resp = await send(sockPath, { op: "resolve", name });
    } else {
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
  console.error("resolve-client error:", (err as Error).message);
  process.exit(1);
});

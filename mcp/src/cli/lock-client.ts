import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { anchorFromEnv, socketDir, socketPathFor } from "./socket-path.js";

interface DaemonResponse {
  ok: boolean;
  error?: string;
  cached?: number;
  idle_sec?: number;
  uptime_sec?: number;
  anchor?: string;
}

function send(sockPath: string, payload: object): Promise<DaemonResponse> {
  return new Promise((resolve) => {
    const conn = net.createConnection(sockPath);
    let buf = "";
    let resolved = false;
    const finish = (resp: DaemonResponse): void => {
      if (resolved) return;
      resolved = true;
      try {
        conn.end();
      } catch {
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
        } catch {
          finish({ ok: false, error: "bad response" });
        }
      }
    });
    conn.on("error", (err) => {
      finish({ ok: false, error: (err as Error).message });
    });
    conn.on("close", () => {
      if (!resolved) finish({ ok: false, error: "closed before response" });
    });
  });
}

function listSockets(): string[] {
  const dir = socketDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sock"))
    .map((f) => path.join(dir, f));
}

async function lockAll(): Promise<void> {
  const sockets = listSockets();
  if (sockets.length === 0) {
    console.log("vault-lock: no active daemons");
    return;
  }
  for (const sockPath of sockets) {
    const resp = await send(sockPath, { op: "lock" });
    const name = path.basename(sockPath);
    if (resp.ok) {
      console.log(`vault-lock: locked ${name}`);
    } else {
      console.log(`vault-lock: ${name}: ${resp.error}`);
      // Clean stale socket files
      try {
        fs.unlinkSync(sockPath);
      } catch {
        // ignore
      }
    }
  }
}

async function lockOne(): Promise<void> {
  const anchor =
    anchorFromEnv() ?? { kind: "pid" as const, pid: process.ppid };
  const sockPath = socketPathFor(anchor);
  if (!fs.existsSync(sockPath)) {
    console.log("vault-lock: no active daemon for this session");
    return;
  }
  const resp = await send(sockPath, { op: "lock" });
  if (resp.ok) {
    console.log("vault-lock: locked");
  } else {
    console.log(`vault-lock: ${resp.error}`);
  }
}

async function status(): Promise<void> {
  const sockets = listSockets();
  if (sockets.length === 0) {
    console.log("vault-status: no active daemons");
    return;
  }
  console.log(`vault-status: ${sockets.length} daemon(s)`);
  for (const sockPath of sockets) {
    const name = path.basename(sockPath);
    const resp = await send(sockPath, { op: "status" });
    if (resp.ok) {
      console.log(
        `  ${name}: cached=${resp.cached} idle=${resp.idle_sec}s uptime=${resp.uptime_sec}s anchor=${resp.anchor}`
      );
    } else {
      console.log(`  ${name}: ${resp.error}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--status")) {
    await status();
  } else if (args.includes("--all")) {
    await lockAll();
  } else {
    await lockOne();
  }
}

main().catch((err) => {
  console.error("lock-client error:", (err as Error).message);
  process.exit(1);
});

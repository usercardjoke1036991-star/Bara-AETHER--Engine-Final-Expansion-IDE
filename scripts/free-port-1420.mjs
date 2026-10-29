#!/usr/bin/env node
// Libera el puerto 1420 (Vite de `tauri dev`) si un proceso anterior lo retiene.
// Windows: netstat + taskkill con rutas fijas de System32 (sin PATH mutable).
// Unix: lsof bajo /usr/bin|/bin.

import { execFileSync } from "node:child_process";
import path from "node:path";

const PORT = 1420;

function windowsSystem32() {
  const root = process.env.SystemRoot || "C:\\Windows";
  return path.join(root, "System32");
}

function pidsOnWindows() {
  const sys = windowsSystem32();
  const netstat = path.join(sys, "netstat.exe");
  const out = execFileSync(netstat, ["-ano", "-p", "tcp"], {
    encoding: "utf8",
    env: { SystemRoot: process.env.SystemRoot || "C:\\Windows", PATH: sys },
  });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes(`:${PORT}`) || !/\sLISTEN\s/i.test(line)) {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function pidsOnUnix() {
  const candidates = ["/usr/bin/lsof", "/bin/lsof"];
  for (const lsof of candidates) {
    try {
      const out = execFileSync(lsof, [`-tiTCP:${PORT}`, "-sTCP:LISTEN"], {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin" },
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out
        .split(/\s+/)
        .map((value) => Number(value))
        .filter((pid) => Number.isInteger(pid) && pid > 0);
    } catch {
      // probar el siguiente candidato
    }
  }
  return [];
}

const pids = process.platform === "win32" ? pidsOnWindows() : pidsOnUnix();
if (pids.length === 0) {
  console.log(`puerto ${PORT} libre`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (process.platform === "win32") {
      const sys = windowsSystem32();
      execFileSync(path.join(sys, "taskkill.exe"), ["/PID", String(pid), "/F"], {
        stdio: "ignore",
        env: { SystemRoot: process.env.SystemRoot || "C:\\Windows", PATH: sys },
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
    console.log(`liberado puerto ${PORT} (pid ${pid})`);
  } catch (error) {
    console.warn(`no se pudo matar pid ${pid}: ${error}`);
  }
}

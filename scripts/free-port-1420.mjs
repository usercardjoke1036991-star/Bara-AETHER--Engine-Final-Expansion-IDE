#!/usr/bin/env node
// Libera el puerto 1420 (Vite de `tauri dev`) si un proceso anterior lo retiene.
// Windows: netstat + taskkill. Unix: lsof/fuser cuando existan.

import { execSync } from "node:child_process";

const PORT = 1420;

function pidsOnWindows() {
  const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
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
  try {
    const out = execSync(`lsof -tiTCP:${PORT} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

const pids = process.platform === "win32" ? pidsOnWindows() : pidsOnUnix();
if (pids.length === 0) {
  console.log(`puerto ${PORT} libre`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    console.log(`liberado puerto ${PORT} (pid ${pid})`);
  } catch (error) {
    console.warn(`no se pudo matar pid ${pid}: ${error}`);
  }
}

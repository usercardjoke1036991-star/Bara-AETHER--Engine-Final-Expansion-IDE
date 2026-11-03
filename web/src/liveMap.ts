// §9.4 — mapa vivo: dependencias, impacto pre-apply, lote atómico, subgrafo IA.

import { invoke } from "@tauri-apps/api/core";

export interface FileDep {
  from: string;
  to: string;
  kind: string;
}

export interface DesyncWarning {
  kind: string;
  path: string;
  detail: string;
}

export interface LiveMapSnapshot {
  files: string[];
  deps: FileDep[];
  warnings: DesyncWarning[];
  truncated: boolean;
  topologyNodes: number;
  topologyEdges: number;
}

export interface ImpactReport {
  focus: string[];
  filesAffected: number;
  testsAffected: number;
  related: string[];
  summary: string;
}

export interface BrokenImport {
  path: string;
  target: string;
  detail: string;
}

export interface ChangeGate {
  ok: boolean;
  impact: ImpactReport;
  broken: BrokenImport[];
  blockReason: string;
}

export interface BatchChange {
  path: string;
  source: string;
  expectedHash?: string | null;
}

export interface BatchReport {
  applied: boolean;
  paths: string[];
  backups: string[];
  rolledBack: boolean;
  detail: string;
}

export interface MapContext {
  focus: string[];
  text: string;
  files: number;
  deps: number;
}

export function liveMapSnapshot(): Promise<LiveMapSnapshot> {
  return invoke<LiveMapSnapshot>("live_map_snapshot");
}

export function liveMapImpact(focus: string[]): Promise<ImpactReport> {
  return invoke<ImpactReport>("live_map_impact", { focus });
}

export function liveMapGate(path: string, source: string): Promise<ChangeGate> {
  return invoke<ChangeGate>("live_map_gate", { path, source });
}

/**
 * Lote atómico multiarchivo (§9.4 / §9.4b).
 * El chat lo usa cuando el diff unificado toca más de un archivo.
 */
export function liveMapApplyBatch(changes: BatchChange[]): Promise<BatchReport> {
  return invoke<BatchReport>("live_map_apply_batch", { changes });
}

/** Specifier npm/scoped o bare → externo (no broken de proyecto). */
export function isExternalJsSpecifier(spec: string): boolean {
  const t = spec.trim();
  if (!t) {
    return true;
  }
  if (t.startsWith("@")) {
    return true;
  }
  return !(t.startsWith(".") || t.startsWith("/") || t.startsWith("#"));
}

export interface DiffFile {
  path: string;
  source: string;
}

/**
 * Lista rutas de un diff unificado (`+++ b/ruta`). Un solo archivo no es lote.
 * El `source` de aquí es sólo el texto `+`/contexto: no se escribe. Para
 * aplicar, usar `mergeUnifiedDiff` contra el host.
 */
export function filesFromUnifiedDiff(diff: string): DiffFile[] {
  const files: { path: string; lines: string[] }[] = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
    const plus = /^\+\+\+ (?:b\/)?(\S.*)$/.exec(line);
    if (plus && plus[1] !== "/dev/null") {
      if (current) {
        files.push(current);
      }
      current = { path: plus[1].trim(), lines: [] };
      continue;
    }
    if (!current) {
      continue;
    }
    if (
      line.startsWith("--- ") ||
      line.startsWith("diff --git ") ||
      line.startsWith("@@") ||
      line.startsWith("\\")
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      current.lines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      continue;
    } else if (line.startsWith(" ")) {
      current.lines.push(line.slice(1));
    }
  }
  if (current) {
    files.push(current);
  }
  return files.map((file) => {
    const body = file.lines.join("\n");
    return {
      path: file.path.replace(/\\/g, "/"),
      source: body.length > 0 && !body.endsWith("\n") ? `${body}\n` : body,
    };
  });
}

export type MergedDiff =
  | { ok: true; files: DiffFile[] }
  | { ok: false; path: string; reason: string };

interface HunkLine {
  kind: " " | "+" | "-";
  text: string;
}

interface ParsedHunk {
  oldStart: number;
  lines: HunkLine[];
}

interface ParsedDiffFile {
  path: string;
  hunks: ParsedHunk[];
  plusOnly: string[];
  sawHunk: boolean;
}

function parseUnifiedFiles(diff: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];
  let current: ParsedDiffFile | null = null;
  let hunk: ParsedHunk | null = null;
  const flushHunk = () => {
    if (current && hunk) {
      current.hunks.push(hunk);
    }
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (current) {
      files.push(current);
    }
    current = null;
  };
  for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
    const plus = /^\+\+\+ (?:b\/)?(\S.*)$/.exec(line);
    if (plus && plus[1] !== "/dev/null") {
      flushFile();
      current = {
        path: plus[1].trim().replace(/\\/g, "/"),
        hunks: [],
        plusOnly: [],
        sawHunk: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("diff --git ") || line.startsWith("--- ")) {
      flushHunk();
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (header) {
      flushHunk();
      current.sawHunk = true;
      hunk = { oldStart: Number(header[1]), lines: [] };
      continue;
    }
    if (line.startsWith("\\")) {
      continue;
    }
    if (hunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      const kind = line[0];
      if (kind === "+" || kind === "-" || kind === " ") {
        hunk.lines.push({ kind, text: line.slice(1) });
      }
      continue;
    }
    if (!current.sawHunk && line.startsWith("+")) {
      current.plusOnly.push(line.slice(1));
    }
  }
  flushFile();
  return files;
}

function hostLinesOf(host: string): string[] {
  const normalized = host.replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return [];
  }
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

/** Aplica hunks `@@` sobre el host. `null` si el contexto no encaja. */
function applyHunks(host: string, hunks: ParsedHunk[]): string | null {
  const lines = hostLinesOf(host);
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.oldStart - 1);
    if (start < cursor || start > lines.length) {
      return null;
    }
    out.push(...lines.slice(cursor, start));
    cursor = start;
    for (const line of hunk.lines) {
      if (line.kind === "+") {
        out.push(line.text);
        continue;
      }
      if (cursor >= lines.length || lines[cursor] !== line.text) {
        return null;
      }
      if (line.kind === " ") {
        out.push(lines[cursor]);
      }
      cursor += 1;
    }
  }
  out.push(...lines.slice(cursor));
  if (out.length === 0) {
    return "";
  }
  return `${out.join("\n")}\n`;
}

/**
 * Fusiona un diff unificado con el contenido actual de cada archivo.
 * Un hunk parcial conserva el resto del host. Si no encaja, no hay source.
 */
export function mergeUnifiedDiff(
  diff: string,
  hosts: Readonly<Record<string, string>>,
): MergedDiff {
  const parsed = parseUnifiedFiles(diff);
  if (parsed.length === 0) {
    return { ok: false, path: "", reason: "el diff no nombra archivos; no se escribe" };
  }
  const files: DiffFile[] = [];
  for (const file of parsed) {
    const host = hosts[file.path] ?? "";
    let source: string | null;
    if (file.sawHunk) {
      source = applyHunks(host, file.hunks);
      if (source === null) {
        return {
          ok: false,
          path: file.path,
          reason: `el parche parcial de «${file.path}» no encaja con el archivo; no se escribe`,
        };
      }
    } else if (host.length === 0) {
      const body = file.plusOnly.join("\n");
      source = body.length > 0 && !body.endsWith("\n") ? `${body}\n` : body;
    } else {
      return {
        ok: false,
        path: file.path,
        reason: `el parche de «${file.path}» no se puede fusionar con el archivo; no se escribe`,
      };
    }
    files.push({ path: file.path, source });
  }
  return { ok: true, files };
}

export function liveMapContext(focus: string[], maxLines = 48): Promise<MapContext> {
  return invoke<MapContext>("live_map_context", { focus, maxLines });
}

/** Empalme local (misma idea que el splice Rust) para simular el archivo tras el parche. */
export function spliceHost(host: string, patch: string, line: number): string {
  const normalized = host.replace(/\r\n/g, "\n");
  const endsNl = normalized.endsWith("\n");
  const lines =
    normalized.length === 0
      ? []
      : normalized.split("\n");
  if (endsNl && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const at = Math.max(0, Math.min(lines.length, Math.max(0, line - 1)));
  const patchBody = patch.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
  const patchLines = patchBody.length === 0 ? [] : patchBody.split("\n");
  const out = [...lines.slice(0, at), ...patchLines, ...lines.slice(at)].join("\n");
  return out.length > 0 && !out.endsWith("\n") ? `${out}\n` : out;
}

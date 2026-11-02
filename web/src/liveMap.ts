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

export function liveMapApplyBatch(changes: BatchChange[]): Promise<BatchReport> {
  return invoke<BatchReport>("live_map_apply_batch", { changes });
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

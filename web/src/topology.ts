// Grafo topológico de la carpeta activa. El backend no recibe la carpeta.

import { invoke } from "@tauri-apps/api/core";

/** Canal local entre la ventana de topología y el editor. No sale de la máquina. */
export const TOPOLOGY_CHANNEL = "bara-topology-reveal";

/** Aviso de veto `⊤∧⊥`. La ventana de topología hace latir el nodo en rojo. */
export const VETO_CHANNEL = "bara-topology-veto";

/** Nodo devuelto por `get_workspace_topology_graph`. */
export interface GraphNode {
  id: string;
  label: string;
  kind: "file" | "function" | "type" | "contract" | string;
  shoreshRoot: string;
  /** Glifo de Belnap: ⊤, ⊥, ⊤∧⊥ o ∅. */
  conflictStatus: string;
  language: string;
  path: string;
  line: number;
}

/** Arista. `weight` es la distancia topológica. */
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

/** Grafo de la carpeta activa. */
export interface WorkspaceTopology {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

/** Pide el grafo al proceso local. */
export function workspaceTopologyGraph(): Promise<WorkspaceTopology> {
  return invoke<WorkspaceTopology>("get_workspace_topology_graph");
}

/** Avisa al editor principal de la línea que hay que mostrar. */
export function publishTopologyReveal(path: string, line: number): void {
  const channel = new BroadcastChannel(TOPOLOGY_CHANNEL);
  channel.postMessage({ path, line });
  channel.close();
}

/** Pide a la ventana de topología que marque un nodo en contradicción. */
export function publishVeto(path: string, line: number): void {
  const channel = new BroadcastChannel(VETO_CHANNEL);
  channel.postMessage({ path, line });
  channel.close();
}

/** Mensaje de veto, o `null` si no tiene la forma esperada. */
export function readVeto(data: unknown): { path: string; line: number } | null {
  return readReveal(data);
}

/** Mensaje del canal, o `null` si no tiene la forma esperada. */
export function readReveal(data: unknown): { path: string; line: number } | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as { path?: unknown; line?: unknown };
  if (typeof record.path !== "string" || typeof record.line !== "number") {
    return null;
  }
  if (!Number.isFinite(record.line) || record.line < 1) {
    return null;
  }
  return { path: record.path, line: Math.floor(record.line) };
}

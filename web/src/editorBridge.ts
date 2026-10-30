// Puente del documento activo entre `main` y `ai-workspace`.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Analysis } from "./engine";

/** Instantánea del editor principal. */
export interface EditorSnapshot {
  path: string;
  name: string;
  source: string;
  analysis: Analysis | null;
  treeOutline: string;
}

/** Publica desde `main` (también emite el evento `editor-context`). */
export function publishEditorContext(snapshot: EditorSnapshot): Promise<EditorSnapshot> {
  return invoke<EditorSnapshot>("editor_context_publish", { snapshot });
}

/** Último contexto guardado en el backend. */
export function getEditorContext(): Promise<EditorSnapshot> {
  return invoke<EditorSnapshot>("editor_context_get");
}

/** Escucha actualizaciones en vivo. */
export async function onEditorContext(
  handler: (snapshot: EditorSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<EditorSnapshot>("editor-context", (event) => {
    handler(event.payload);
  });
}

/** Lectura de solo lectura para el asistente. */
export function readProjectFile(path: string): Promise<{ path: string; name: string; source: string }> {
  return invoke("workspace_read_project_file", { path });
}

/** Árbol plano para el prompt (rutas relativas). */
export function outlineTree(
  entries: Array<{ path: string; kind: string; children?: unknown[] }>,
  depth = 0,
  lines: string[] = [],
): string {
  for (const entry of entries) {
    if (lines.length >= 400) {
      lines.push("… (árbol recortado)");
      break;
    }
    const pad = "  ".repeat(depth);
    lines.push(`${pad}${entry.kind === "dir" ? "📁" : "·"} ${entry.path}`);
    const children = entry.children as Array<{ path: string; kind: string; children?: unknown[] }> | undefined;
    if (children && children.length > 0) {
      outlineTree(children, depth + 1, lines);
    }
  }
  return lines.join("\n");
}

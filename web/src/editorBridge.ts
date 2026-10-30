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

/** Evento Tauri: la ventana de asistencia pide un diff en `main`. */
export const PROPOSE_PATCH_EVENT = "assistant-propose-patch";

/** Emite el parche a la ventana principal (sin escribir). */
export function proposeEditorPatch(patch: string): Promise<void> {
  return invoke("propose_editor_patch", { patch });
}

/** Abre DevTools (solo debug / feature `devtools`). */
export function openDevtools(): Promise<void> {
  return invoke("open_devtools_window");
}

/** Profundidad máxima del árbol inyectado al prompt. */
export const TREE_MAX_DEPTH = 3;

/** Líneas máximas del árbol inyectado al prompt. */
export const TREE_MAX_LINES = 80;

/** Árbol plano para el prompt (solo rutas relativas, profundidad limitada). */
export function outlineTree(
  entries: Array<{ path: string; kind: string; children?: unknown[] }>,
  depth = 0,
  lines: string[] = [],
  maxDepth = TREE_MAX_DEPTH,
  maxLines = TREE_MAX_LINES,
): string {
  for (const entry of entries) {
    if (lines.length >= maxLines) {
      lines.push("… (árbol recortado)");
      break;
    }
    lines.push(entry.path);
    const children = entry.children as
      | Array<{ path: string; kind: string; children?: unknown[] }>
      | undefined;
    if (children && children.length > 0 && depth + 1 < maxDepth) {
      outlineTree(children, depth + 1, lines, maxDepth, maxLines);
    }
  }
  return lines.join("\n");
}

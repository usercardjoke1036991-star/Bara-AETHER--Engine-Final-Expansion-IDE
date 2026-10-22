// Puente tipado del explorador de workspace (`src-tauri/src/workspace.rs`).
//
// El backend es quien decide qué se puede ver y tocar: enumera el árbol sin
// `target/`, `node_modules/` ni `.git/`, y sólo lee o escribe documentos
// `.bara` cuya ruta canónica quede dentro de la raíz. Aquí no hay validación
// de seguridad duplicada: sólo se declara el mismo contrato en TypeScript.

import { invoke } from "@tauri-apps/api/core";

/** Tipo de nodo del árbol. */
export type WorkspaceEntryKind = "dir" | "file";

/** Nodo recursivo del workspace. */
export interface WorkspaceEntry {
  /** Nombre visible (un componente de ruta). */
  name: string;
  /** Ruta relativa a la raíz, separada por `/`. */
  path: string;
  /** Directorio o archivo. */
  kind: WorkspaceEntryKind;
  /** `true` si es un documento editable `.bara`. */
  bara: boolean;
  /** Hijos de un directorio (vacío en archivos). */
  children: WorkspaceEntry[];
}

/** Árbol completo que devuelve `workspace_tree`. */
export interface WorkspaceTree {
  /** Raíz canónica y absoluta del workspace. */
  root: string;
  /** Nombre de la carpeta raíz. */
  name: string;
  /** Entradas de primer nivel. */
  entries: WorkspaceEntry[];
  /** Documentos `.bara` encontrados. */
  files: number;
  /** `true` si el backend recortó la enumeración. */
  truncated: boolean;
}

/** Documento leído o guardado en el workspace. */
export interface WorkspaceDocument {
  /** Raíz canónica del workspace. */
  root: string;
  /** Ruta relativa normalizada con `/`. */
  path: string;
  /** Nombre del archivo. */
  name: string;
  /** Contenido UTF-8 persistido. */
  source: string;
}

/** Directorio de lanzamiento. No cambia la jaula activa. */
export function workspaceDefaultRoot(): Promise<string> {
  return invoke<string>("workspace_default_root");
}

/** Enumera la raíz activa. El WebView no envía la ruta. */
export function workspaceTree(): Promise<WorkspaceTree> {
  return invoke<WorkspaceTree>("workspace_tree");
}

/** Lee un `.bara` relativo a la raíz activa. */
export function workspaceReadDocument(path: string): Promise<WorkspaceDocument> {
  return invoke<WorkspaceDocument>("workspace_read_document", { path });
}

/** Lee una fuente del proyecto (relativa) para abrirla desde el grafo. */
export function workspaceReadSource(path: string): Promise<WorkspaceDocument> {
  return invoke<WorkspaceDocument>("workspace_source_text", { path });
}

/**
 * Diálogo nativo de carpetas. La ruta la elige el sistema operativo y el
 * backend la canoniza antes de devolver el árbol.
 */
export function workspaceOpenDialog(): Promise<WorkspaceTree> {
  return invoke<WorkspaceTree>("workspace_open_dialog");
}

/**
 * Clona un repo de GitHub en la carpeta que elija el diálogo y lo abre.
 * El progreso llega por el evento `github-clone-progress`.
 */
export function githubClone(url: string): Promise<WorkspaceTree> {
  return invoke<WorkspaceTree>("github_clone", { url });
}

/** Carpeta abierta en el estante. El identificador lo emite el backend. */
export interface WorkspaceRootView {
  id: string;
  path: string;
  name: string;
  active: boolean;
}

/** Estante de carpetas. Cada una conserva su propia jaula. */
export interface WorkspaceShelf {
  activeId: string;
  roots: WorkspaceRootView[];
}

/** Carpetas abiertas y cuál está activa. */
export function workspaceRoots(): Promise<WorkspaceShelf> {
  return invoke<WorkspaceShelf>("workspace_roots");
}

/** Activa una carpeta por el identificador del backend. */
export function workspaceActivate(id: string): Promise<WorkspaceShelf> {
  return invoke<WorkspaceShelf>("workspace_activate", { id });
}

/** Cierra una carpeta. La última del estante permanece. */
export function workspaceCloseRoot(id: string): Promise<WorkspaceShelf> {
  return invoke<WorkspaceShelf>("workspace_close_root", { id });
}

/** Guarda un `.bara` relativo a la raíz activa y devuelve lo persistido. */
export function workspaceWriteDocument(
  path: string,
  source: string,
): Promise<WorkspaceDocument> {
  return invoke<WorkspaceDocument>("workspace_write_document", { path, source });
}

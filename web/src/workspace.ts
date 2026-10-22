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

/** Directorio de lanzamiento de la ventana (punto de partida del explorador). */
export function workspaceDefaultRoot(): Promise<string> {
  return invoke<string>("workspace_default_root");
}

/** Enumera recursivamente `root` sin los directorios de artefactos. */
export function workspaceTree(root: string): Promise<WorkspaceTree> {
  return invoke<WorkspaceTree>("workspace_tree", { root });
}

/** Lee un `.bara` confinado a `root`. */
export function workspaceReadDocument(
  root: string,
  path: string,
): Promise<WorkspaceDocument> {
  return invoke<WorkspaceDocument>("workspace_read_document", { root, path });
}

/** Guarda un `.bara` confinado a `root` y devuelve lo persistido. */
export function workspaceWriteDocument(
  root: string,
  path: string,
  source: string,
): Promise<WorkspaceDocument> {
  return invoke<WorkspaceDocument>("workspace_write_document", {
    root,
    path,
    source,
  });
}

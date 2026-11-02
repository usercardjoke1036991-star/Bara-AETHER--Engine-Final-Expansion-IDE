/** Extensiones editables en el IDE (alineadas con SOURCE_EXTENSIONS del backend). */
export const EDITOR_EXTENSIONS = [
  "bara",
  "rs",
  "py",
  "go",
  "sol",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "js",
  "jsx",
  "ts",
  "tsx",
  "md",
  "txt",
  "json",
  "toml",
  "yaml",
  "yml",
  "css",
  "html",
] as const;

export function extensionOf(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

/** ¿Se puede abrir/editar en el editor (no implica badge verificado)? */
export function isEditorPath(path: string): boolean {
  const ext = extensionOf(path);
  return (EDITOR_EXTENSIONS as readonly string[]).includes(ext);
}

export function isBaraPath(path: string): boolean {
  return extensionOf(path) === "bara";
}

/**
 * Badge de estado: «verificado» sólo en `.bara`;
 * en otros lenguajes «equilibrado» / «sin choque».
 */
export type EditorBadge =
  | "verificado"
  | "no verificado"
  | "equilibrado"
  | "sin choque"
  | "sin análisis";

export function editorBadge(
  path: string,
  opts: { verified: boolean | null; clash?: boolean | null },
): EditorBadge {
  if (!path) {
    return "sin análisis";
  }
  if (isBaraPath(path)) {
    if (opts.verified === null) {
      return "sin análisis";
    }
    return opts.verified ? "verificado" : "no verificado";
  }
  if (opts.clash === true) {
    return "sin choque";
  }
  if (opts.clash === false || opts.verified !== null) {
    return "equilibrado";
  }
  return "equilibrado";
}

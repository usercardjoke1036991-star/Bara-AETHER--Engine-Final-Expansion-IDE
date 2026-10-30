// Comparación de rutas del workspace. En Windows el FS no distingue mayúsculas.

/** ¿El host actual es Windows? (Vitest/Node: `win32`; WebView Tauri: userAgent). */
export function isWindowsHost(): boolean {
  if (typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent)) {
    return true;
  }
  if (typeof process !== "undefined" && process.platform === "win32") {
    return true;
  }
  return false;
}

/** Normaliza separadores y recorta; no resuelve `.`/`..`. */
export function normalizeWorkspacePath(path: string | null | undefined): string {
  return (path ?? "").trim().replaceAll("\\", "/");
}

/** Clave de comparación: en Windows, minúsculas ASCII. */
export function pathKey(path: string | null | undefined): string {
  const normalized = normalizeWorkspacePath(path);
  return isWindowsHost() ? normalized.toLowerCase() : normalized;
}

/** Igualdad de rutas del workspace (case-insensitive en Windows). */
export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeWorkspacePath(a);
  const right = normalizeWorkspacePath(b);
  if (!left || !right) {
    return left === right;
  }
  return pathKey(left) === pathKey(right);
}

/** Entrada mínima de árbol para deduplicar. */
export interface PathTreeNode {
  path: string;
  kind: string;
  children?: PathTreeNode[];
}

/**
 * Quita duplicados por pathKey (p. ej. Hello.bara / hELLO.bara en Windows).
 * Conserva la primera aparición.
 */
export function dedupeTreeByPathKey<T extends PathTreeNode>(entries: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const key = pathKey(entry.path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const children = entry.children;
    if (children && children.length > 0) {
      out.push({ ...entry, children: dedupeTreeByPathKey(children) });
    } else {
      out.push(entry);
    }
  }
  return out;
}

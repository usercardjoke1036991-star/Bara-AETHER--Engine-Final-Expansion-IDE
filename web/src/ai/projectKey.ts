import { normalizeWorkspacePath } from "../paths";

/**
 * Clave estable de historial/recientes a partir de la raíz del workspace.
 * Siempre en minúsculas (también en Linux/CI) para que `\\?\C:\…` y `C:/…`
 * compartan hilo aunque el runner no sea Windows.
 */
export function projectKey(root: string): string {
  let normalized = normalizeWorkspacePath(root);
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

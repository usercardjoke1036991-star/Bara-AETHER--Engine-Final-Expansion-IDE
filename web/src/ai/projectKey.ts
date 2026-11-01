/** Clave estable de historial/recientes a partir de la raíz del workspace. */
export function projectKey(root: string): string {
  let normalized = root.replace(/\\/g, "/").trim().toLowerCase();
  // Canonización Win32 extendida: \\?\C:\... → //?/c:/... → c:/...
  normalized = normalized.replace(/^\/\/\?\//, "").replace(/^\/\?\//, "");
  return normalized;
}

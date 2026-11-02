import { pathKey } from "../paths";

/** Clave estable de historial/recientes a partir de la raíz del workspace. */
export function projectKey(root: string): string {
  return pathKey(root);
}

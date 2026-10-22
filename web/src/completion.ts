// Sugerencias locales del cursor. El backend no recibe la carpeta: sólo la
// línea, el prefijo y la ruta relativa del documento abierto.

import { invoke } from "@tauri-apps/api/core";

/** Una sugerencia ordenada por distancia topológica. */
export interface LocalCompletion {
  /** Inserción completa, incluido el prefijo ya escrito. */
  text: string;
  /** Inserción hasta el siguiente segmento. */
  partial: string;
  /** Origen de la sugerencia (raíz, función, malla, patrón). */
  detail: string;
  /** Distancia topológica respecto del prefijo. */
  distance: number;
  /** Cohesión, en milésimas, con la malla de la carpeta activa. */
  cohesionMilli: number;
}

/** Pide sugerencias al proceso local. No hay ninguna llamada de red aquí. */
export function localCompletions(
  line: number,
  prefix: string,
  path: string,
): Promise<LocalCompletion[]> {
  return invoke<LocalCompletion[]>("get_local_completions", { line, prefix, path });
}

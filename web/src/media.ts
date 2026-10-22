// Inspección multimedia. El diálogo y la cota de 32 MB viven en Rust.
// La respuesta no trae píxeles ni la ruta absoluta.

import { invoke } from "@tauri-apps/api/core";

/** Metadatos que devuelve `inspect_media_dialog`. */
export interface MediaInspection {
  name: string;
  bytes: number;
  kind: "video" | "image" | string;
}

/** Abre el diálogo nativo y rechaza lo que supere 33_554_432 bytes. */
export function inspectMediaDialog(): Promise<MediaInspection> {
  return invoke<MediaInspection>("inspect_media_dialog");
}

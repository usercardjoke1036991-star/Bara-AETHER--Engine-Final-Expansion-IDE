// Ventanas de escritorio del IDE.
//
// Cada vista es una etiqueta Tauri (`main`, `topology`, `autopoiesis`,
// `telemetry`, `ai-workspace`). El backend rechaza cualquier otra. En el
// navegador, sin WebView, la vista se lee de `?vista=` para poder revisar
// el layout.

import { invoke } from "@tauri-apps/api/core";

/** Vistas que el backend sabe abrir. */
export type DeskVista = "main" | "topology" | "autopoiesis" | "telemetry" | "ai-workspace";

const VISTAS: readonly DeskVista[] = [
  "main",
  "topology",
  "autopoiesis",
  "telemetry",
  "ai-workspace",
];

function isVista(value: string | null): value is DeskVista {
  return VISTAS.some((vista) => vista === value);
}

/** Etiqueta de la ventana actual. Fuera de Tauri, `main` o `?vista=`. */
export async function currentVista(): Promise<DeskVista> {
  const query = new URLSearchParams(window.location.search).get("vista");
  if (!("__TAURI_INTERNALS__" in window)) {
    return isVista(query) ? query : "main";
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const label = getCurrentWindow().label;
  return isVista(label) ? label : "main";
}

/** Abre o enfoca una ventana registrada. */
export function openDeskWindow(vista: DeskVista): Promise<void> {
  return invoke<void>("open_desk_window", { vista });
}

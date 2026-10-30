// Puente del modo autónomo. El núcleo decide; este archivo sólo pide el juicio,
// la confirmación con respaldo y el deshacer.

import { invoke } from "@tauri-apps/api/core";

export interface AutoApplyReport {
  glyph: string;
  status: string;
  applied: boolean;
  path: string;
  line: number;
  inserted: number;
  source: string;
  verified: boolean;
  unverifiedReason: string;
  previewDiff: string;
  canApply: boolean;
  blockReason: string;
  backupPath: string;
}

/** Informe vacío tipado (p. ej. sin documento abierto). */
export function emptyReport(line = 1): AutoApplyReport {
  return {
    glyph: "⊥",
    status: "false",
    applied: false,
    path: "",
    line,
    inserted: 0,
    source: "",
    verified: false,
    unverifiedReason: "",
    previewDiff: "",
    canApply: false,
    blockReason: "Abre un archivo .bara primero",
    backupPath: "",
  };
}

/** Clave persistente del interruptor Auto-Apply (cola de diff, no escritura). */
export const AUTO_APPLY_KEY = "bara.autoApply";

/** Marca de migración v2: el `"1"` antiguo significaba escritura silenciosa. */
export const AUTO_APPLY_MIGRATION_KEY = "bara.autoApply.v2";

/** Auto-Apply apagado por defecto; migra una sola vez el modo silencioso a off. */
export function readAutoApplyEnabled(): boolean {
  try {
    if (localStorage.getItem(AUTO_APPLY_MIGRATION_KEY) !== "1") {
      localStorage.setItem(AUTO_APPLY_KEY, "0");
      localStorage.setItem(AUTO_APPLY_MIGRATION_KEY, "1");
      return false;
    }
    return localStorage.getItem(AUTO_APPLY_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAutoApplyEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_APPLY_MIGRATION_KEY, "1");
    localStorage.setItem(AUTO_APPLY_KEY, enabled ? "1" : "0");
  } catch {
    // El almacén puede estar cerrado.
  }
}

/** Juzga sin escribir. */
export function judgeAutoPatch(
  path: string,
  line: number,
  host: string,
  patch: string,
): Promise<AutoApplyReport> {
  return invoke<AutoApplyReport>("judge_auto_patch", { path, line, host, patch });
}

/** Escribe tras aceptar el diff; crea respaldo en `.bara-backup/`. */
export function confirmAutoPatch(
  path: string,
  line: number,
  host: string,
  patch: string,
): Promise<AutoApplyReport> {
  return invoke<AutoApplyReport>("confirm_auto_patch", { path, line, host, patch });
}

/** Restaura el archivo desde el respaldo. */
export function undoAutoPatch(path: string, backupPath: string): Promise<AutoApplyReport> {
  return invoke<AutoApplyReport>("undo_auto_patch", { path, backupPath });
}

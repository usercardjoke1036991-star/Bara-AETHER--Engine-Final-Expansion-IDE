// A9 — espacio libre en C: y limpieza segura (mismas reglas que disk-guard.ps1).

import { invoke } from "@tauri-apps/api/core";

export interface DiskFreeReport {
  freeGb: number;
  belowMin: boolean;
  minGb: number;
}

export interface DiskCleanReport {
  freeGbBefore: number;
  freeGbAfter: number;
  freedGb: number;
  detail: string;
}

export function diskFreeCheck(minGb = 8): Promise<DiskFreeReport> {
  return invoke<DiskFreeReport>("disk_free_check", { minGb });
}

/** Limpia sólo target\debug y caches seguras del workspace. */
export function diskCleanSafe(minGb = 8): Promise<DiskCleanReport> {
  return invoke<DiskCleanReport>("disk_clean_safe", { minGb });
}

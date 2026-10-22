// Puente del modo autónomo. El núcleo decide; este archivo sólo pide el juicio.

import { invoke } from "@tauri-apps/api/core";

export interface AutoApplyReport {
  glyph: string;
  status: string;
  applied: boolean;
  path: string;
  line: number;
  inserted: number;
  source: string;
}

export function judgeAutoPatch(
  path: string,
  line: number,
  host: string,
  patch: string,
): Promise<AutoApplyReport> {
  return invoke<AutoApplyReport>("judge_auto_patch", { path, line, host, patch });
}

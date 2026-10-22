// Inferencia GGUF y propagación trans-archivo. Ninguna de las dos abre la red.

import { invoke } from "@tauri-apps/api/core";

export interface WeightView {
  name: string;
  architecture: string;
  context: number;
  tensors: number;
  parameters: number;
}

export interface LocalReply {
  name: string;
  architecture: string;
  glyph: string;
  reply: string;
}

export interface GlobalFile {
  path: string;
  glyph: string;
  status: string;
  changed: boolean;
}

export interface GlobalReport {
  glyph: string;
  status: string;
  applied: boolean;
  fromName: string;
  toName: string;
  files: GlobalFile[];
}

export function loadLocalWeights(): Promise<WeightView> {
  return invoke<WeightView>("load_local_weights");
}

export function localComplete(prompt: string): Promise<LocalReply> {
  return invoke<LocalReply>("local_complete", { prompt });
}

export function transmuteGlobal(path: string, from: string, to: string): Promise<GlobalReport> {
  return invoke<GlobalReport>("transmute_global", { path, from, to });
}

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

/**
 * Inferencia local vía IPC. `signal` (B8) corta la espera de la interfaz;
 * `interruptKernel` en Detener corta el proceso hijo.
 */
export async function localComplete(
  prompt: string,
  signal?: AbortSignal,
): Promise<LocalReply> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("abortado", "AbortError");
  }
  const pending = invoke<LocalReply>("local_complete", { prompt });
  if (!signal) {
    return pending;
  }
  return new Promise((resolve, reject) => {
    const fail = () => reject(signal.reason ?? new DOMException("abortado", "AbortError"));
    const onAbort = () => fail();
    signal.addEventListener("abort", onAbort);
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function transmuteGlobal(path: string, from: string, to: string): Promise<GlobalReport> {
  return invoke<GlobalReport>("transmute_global", { path, from, to });
}

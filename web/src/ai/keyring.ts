// Puente del llavero. El secreto sólo viaja hacia el proceso, nunca de vuelta.

import { invoke } from "@tauri-apps/api/core";

import type { ProviderId } from "./types";

/** El escritorio Tauri expone este símbolo. El navegador suelto no. */
export function inDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Guarda la clave. `remember` elige el llavero del sistema o la sesión. */
export async function saveKey(
  provider: ProviderId,
  secret: string,
  remember: boolean,
): Promise<void> {
  await invoke("ai_key_save", { provider, secret, remember });
}

/** `true` si el proceso tiene clave. No devuelve el secreto. */
export async function keyExists(provider: ProviderId): Promise<boolean> {
  if (!inDesktop()) {
    return false;
  }
  return invoke<boolean>("ai_key_exists", { provider });
}

/** Borra la clave de la sesión y del llavero. */
export async function deleteKey(provider: ProviderId): Promise<void> {
  if (!inDesktop()) {
    return;
  }
  await invoke("ai_key_delete", { provider });
}

/** Respuesta del transporte. `body` ya no contiene la clave. */
export interface ExchangeResult {
  status: number;
  body: string;
}

/** Paso de la sonda «Probar conexión». */
export interface ProbeStep {
  name: string;
  ok: boolean;
  detail: string;
}

/** Informe DNS → TCP → TLS → HTTP → modelos. */
export interface ProbeReport {
  ok: boolean;
  steps: ProbeStep[];
  models: string[];
}

/** Sonda el camino hasta el proveedor. La clave no viaja en el argumento. */
export async function probeConnection(
  provider: ProviderId,
  baseUrl: string,
): Promise<ProbeReport> {
  return invoke<ProbeReport>("ai_probe_connection", {
    provider,
    baseUrl,
  });
}

/**
 * Pide al proceso que llame al proveedor. La clave no va en este argumento.
 * `signal` corta la espera de la interfaz; el plazo del proceso es el suyo.
 */
export async function exchange(
  provider: ProviderId,
  url: string,
  method: "GET" | "POST",
  body: string | undefined,
  signal?: AbortSignal,
): Promise<ExchangeResult> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("abortado", "AbortError");
  }
  const pending = invoke<ExchangeResult>("ai_exchange", {
    provider,
    url,
    method,
    body: body ?? null,
  });
  return new Promise((resolve, reject) => {
    const fail = () => reject(signal?.reason ?? new DOMException("abortado", "AbortError"));
    const onAbort = () => fail();
    signal?.addEventListener("abort", onAbort);
    pending.then(
      (value) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

// M5 — Workspace Trust. La fuente de verdad es el proceso Rust (no localStorage).

import { invoke } from "@tauri-apps/api/core";

/** Carpetas canónicas confiadas. */
export function workspaceTrustList(): Promise<string[]> {
  return invoke<string[]>("workspace_trust_list");
}

/** ¿Esta ruta (canónica o no) está confiada? */
export function workspaceTrustIsTrusted(path: string): Promise<boolean> {
  return invoke<boolean>("workspace_trust_is_trusted", { path });
}

/** Confiar en una carpeta. Devuelve la forma API canónica. */
export function workspaceTrustGrant(path: string): Promise<string> {
  return invoke<string>("workspace_trust_grant", { path });
}

/** Revocar confianza. */
export function workspaceTrustRevoke(path: string): Promise<void> {
  return invoke<void>("workspace_trust_revoke", { path });
}

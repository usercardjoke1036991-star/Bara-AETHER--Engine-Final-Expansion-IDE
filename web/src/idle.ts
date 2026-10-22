// Aviso del hilo de reposo. El kernel propone; este módulo no escribe solo.

import { invoke } from "@tauri-apps/api/core";

export interface IdleNotice {
  path: string;
  name: string;
  message: string;
}

export function idleProposal(): Promise<IdleNotice | null> {
  return invoke<IdleNotice | null>("idle_proposal");
}

export function idleApply(): Promise<boolean> {
  return invoke<boolean>("idle_apply");
}

export function idleDismiss(): Promise<void> {
  return invoke<void>("idle_dismiss");
}

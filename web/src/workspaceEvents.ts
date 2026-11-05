/** Contrato del evento Tauri al cambiar la carpeta activa del estante. */
export const WORKSPACE_ROOT_CHANGED = "workspace-root-changed" as const;

export type WorkspaceRootChangedReason =
  | "activate"
  | "close"
  | "reopen"
  | "open"
  | "clone"
  | "event"
  | string;

export interface WorkspaceRootChangedPayload {
  root?: string;
  reason?: WorkspaceRootChangedReason;
}

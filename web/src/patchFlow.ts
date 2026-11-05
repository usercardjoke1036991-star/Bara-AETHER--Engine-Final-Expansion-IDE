// Orquestación de «usar en el editor» (testeable sin Tauri).

import { isEditorPath } from "./editorFiles";
import { filesFromUnifiedDiff } from "./liveMap";
import {
  proposeFromJudge,
  reviewNotice,
  type ProposeOutcome,
} from "./proposePatch";
import type { AutoApplyReport } from "./autoApply";

/** Aviso cuando el documento activo no es editable. */
export const NEED_EDITOR_FILE = "Abre un archivo del editor primero";

function isSafeEditorPath(path: string | null | undefined): boolean {
  const name = (path ?? "").trim().replace(/\\/g, "/");
  if (!name || name === "<fragmento>" || name === "<editor>") {
    return false;
  }
  if (name.startsWith("/") || name.includes("..") || /^[A-Za-z]:/.test(name)) {
    return false;
  }
  return isEditorPath(name);
}

/** Fases de depuración (nunca incluyen secretos). */
export type PatchFlowPhase =
  | "emit"
  | "recv"
  | "ensure_open"
  | "need_file"
  | "judge"
  | "review"
  | "blocked"
  | "reject"
  | "error"
  | "root_reset";

export interface PatchFlowLog {
  phase: PatchFlowPhase;
  vista?: string;
  document?: string;
  detail?: string;
}

/** Línea de log estable para consola / banner (sin API keys). */
export function formatPatchDebug(log: PatchFlowLog): string {
  const vista = log.vista ?? "-";
  const document = log.document ?? "-";
  const detail = log.detail ? ` ${log.detail}` : "";
  return `[patch-flow] ${log.phase} vista=${vista} doc=${document}${detail}`;
}

/** El listener de main NO debe depender de que el chat esté abierto. */
export function shouldListenForPropose(inDesktop: boolean, _chatOpen?: boolean): boolean {
  return inDesktop;
}

/** Validación previa al juez: vacío, o sin archivo editable (cualquier extensión del editor). */
export function preflightPatch(
  patch: string,
  documentName: string | null | undefined,
):
  | { ok: true; code: string }
  | { ok: false; notice: string; log: PatchFlowLog } {
  const code = patch.trim();
  if (!code) {
    return {
      ok: false,
      notice: "El bloque está vacío: no hay nada que aplicar.",
      log: { phase: "blocked", document: documentName ?? "", detail: "empty_patch" },
    };
  }
  const batch = filesFromUnifiedDiff(code);
  if (batch.length > 1) {
    const bad = batch.find((file) => !isSafeEditorPath(file.path));
    if (bad) {
      return {
        ok: false,
        notice: `«${bad.path}» no es un archivo del editor`,
        log: {
          phase: "blocked",
          document: bad.path,
          detail: "lote con ruta no editable",
        },
      };
    }
    return { ok: true, code };
  }
  if (!isSafeEditorPath(documentName)) {
    return {
      ok: false,
      notice: NEED_EDITOR_FILE,
      log: {
        phase: "need_file",
        document: documentName ?? "",
        detail: "sin archivo del editor",
      },
    };
  }
  return { ok: true, code };
}

/**
 * Tras el juez: decide outcome y el aviso obligatorio (nunca silencio).
 */
export function resolvePatchAttempt(
  patch: string,
  documentName: string | null | undefined,
  report: AutoApplyReport,
): { outcome: ProposeOutcome | { kind: "empty" }; notice: string; log: PatchFlowLog } {
  const pre = preflightPatch(patch, documentName);
  if (!pre.ok) {
    return {
      outcome: pre.log.phase === "need_file" ? { kind: "need_file", notice: pre.notice } : { kind: "empty" },
      notice: pre.notice,
      log: pre.log,
    };
  }
  const outcome = proposeFromJudge(pre.code, report, true);
  if (outcome.kind === "review") {
    return {
      outcome,
      notice: reviewNotice(outcome.report),
      log: {
        phase: "review",
        document: documentName ?? "",
        detail: `diff=${outcome.report.previewDiff.length}c verified=${outcome.report.verified} canApply=${outcome.report.canApply}`,
      },
    };
  }
  return {
    outcome,
    notice: outcome.notice,
    log: {
      phase: outcome.kind === "need_file" ? "need_file" : "blocked",
      document: documentName ?? "",
      detail: outcome.notice.slice(0, 120),
    },
  };
}

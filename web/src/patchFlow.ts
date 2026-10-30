// Orquestación de «usar en el editor» (testeable sin Tauri).

import { NEED_BARA_FILE, isActiveBaraPath, proposeFromJudge, type ProposeOutcome } from "./proposePatch";
import type { AutoApplyReport } from "./autoApply";

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

/** Validación previa al juez: vacío o sin `.bara` activo. */
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
  if (!isActiveBaraPath(documentName)) {
    return {
      ok: false,
      notice: NEED_BARA_FILE,
      log: {
        phase: "need_file",
        document: documentName ?? "",
        detail: "sin .bara activo",
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
      notice: `${outcome.report.glyph}: revisa el diff y acepta o rechaza. Nada se ha escrito todavía.`,
      log: {
        phase: "review",
        document: documentName ?? "",
        detail: `diff=${outcome.report.previewDiff.length}c`,
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

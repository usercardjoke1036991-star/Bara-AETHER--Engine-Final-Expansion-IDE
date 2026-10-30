// Propuesta de parche al editor: siempre con diff; nunca escritura silenciosa.

import type { AutoApplyReport } from "./autoApply";

/** Aviso cuando no hay `.bara` activo en el workspace. */
export const NEED_BARA_FILE = "Abre un archivo .bara primero";

/** ¿El nombre del documento activo admite un parche con diff? */
export function isActiveBaraPath(documentName: string | null | undefined): boolean {
  const name = (documentName ?? "").trim();
  if (!name || name === "<fragmento>" || name === "<editor>") {
    return false;
  }
  return name.toLowerCase().endsWith(".bara");
}

/** Resultado de preparar una revisión (solo diff; nada escrito). */
export type ProposeOutcome =
  | { kind: "need_file"; notice: string }
  | { kind: "blocked"; notice: string; report: AutoApplyReport }
  | { kind: "review"; patch: string; report: AutoApplyReport };

/**
 * Interpreta el informe del juez sin escribir. La UI muestra Accept/Reject.
 */
export function proposeFromJudge(patch: string, report: AutoApplyReport, hasFile: boolean): ProposeOutcome {
  if (!hasFile) {
    return { kind: "need_file", notice: NEED_BARA_FILE };
  }
  if (report.status === "neither" || report.glyph === "∅") {
    return {
      kind: "blocked",
      notice:
        report.blockReason ||
        `∅ falta información: no se escribe (${report.unverifiedReason || "sin detalle"}).`,
      report,
    };
  }
  if (report.status === "both") {
    return {
      kind: "blocked",
      notice: `Veto ${report.glyph}: el bloque contradice el archivo. Hace falta intervención manual.`,
      report,
    };
  }
  if (!report.verified || !report.canApply || !report.previewDiff) {
    return {
      kind: "blocked",
      notice:
        report.blockReason ||
        report.unverifiedReason ||
        `${report.glyph}: propuesta no verificada o sin diff; no se escribe.`,
      report,
    };
  }
  return { kind: "review", patch, report };
}

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
 * Interpreta el informe del juez sin escribir.
 * «No verificado» / ∅ bloquean Auto-Apply (`canApply`), no el panel Aceptar/Rechazar.
 */
export function proposeFromJudge(patch: string, report: AutoApplyReport, hasFile: boolean): ProposeOutcome {
  if (!hasFile) {
    return { kind: "need_file", notice: NEED_BARA_FILE };
  }
  // Veto duro sin diff usable: no hay revisión.
  if (report.status === "both" && !report.previewDiff) {
    return {
      kind: "blocked",
      notice: `Veto ${report.glyph}: el bloque contradice el archivo. Hace falta intervención manual.`,
      report,
    };
  }
  if (!report.previewDiff.trim()) {
    return {
      kind: "blocked",
      notice:
        report.blockReason ||
        report.unverifiedReason ||
        `${report.glyph}: sin diff que revisar; no se escribe.`,
      report,
    };
  }
  // Con previewDiff siempre abrimos revisión manual (también ∅ / no verificado).
  return { kind: "review", patch, report };
}

/** Aviso visible encima del diff (no sustituye Aceptar/Rechazar). */
export function reviewNotice(report: AutoApplyReport): string {
  const base = `${report.glyph}: revisa el diff y acepta o rechaza. Nada se ha escrito todavía.`;
  if (report.verified && report.canApply) {
    return base;
  }
  const detail =
    report.blockReason ||
    report.unverifiedReason ||
    "propuesta no verificada: Auto-Apply bloqueado; puedes Aceptar a mano";
  return `${base} Aviso: ${detail}`;
}

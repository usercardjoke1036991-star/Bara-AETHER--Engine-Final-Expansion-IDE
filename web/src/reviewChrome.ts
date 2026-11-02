import type { AutoApplyReport } from "./autoApply";
import { reviewNotice } from "./proposePatch";

/** Estado elevado al banner de la app (Aceptar/Rechazar/Deshacer siempre visibles). */
export type ReviewChromeState = {
  notice: string;
  showAccept: boolean;
  showReject: boolean;
  showUndo: boolean;
  undoLabel: string;
};

/** Chrome vivo con handlers (banner App + barra sticky del chat). */
export type ReviewChromeLive = ReviewChromeState & {
  accept: () => void;
  reject: () => void;
  undo: () => void;
};

/**
 * Construye el chrome de revisión para el banner y la barra sticky del chat.
 * Acciones visibles sin depender del scroll del diff.
 */
export function buildReviewChrome(
  review: { report: AutoApplyReport; mapBlock?: string } | null,
  lastBackup: { backupPath: string } | null,
): ReviewChromeState | null {
  if (!review && !lastBackup) {
    return null;
  }
  if (review) {
    return {
      notice: reviewNotice(review.report),
      // §9.4b: mapBlock deshabilita Aceptar (banner + sticky).
      showAccept: !review.mapBlock,
      showReject: true,
      showUndo: Boolean(lastBackup),
      undoLabel: lastBackup?.backupPath ?? "",
    };
  }
  return {
    notice: `Respaldo listo: ${lastBackup?.backupPath ?? ""}. Puedes Deshacer.`,
    showAccept: false,
    showReject: false,
    showUndo: true,
    undoLabel: lastBackup?.backupPath ?? "",
  };
}

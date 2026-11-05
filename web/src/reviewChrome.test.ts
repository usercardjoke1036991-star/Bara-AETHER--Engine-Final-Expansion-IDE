import { describe, expect, it } from "vitest";

import type { AutoApplyReport } from "./autoApply";
import { emptyReport } from "./autoApply";
import { buildReviewChrome } from "./reviewChrome";

function report(partial: Partial<AutoApplyReport>): AutoApplyReport {
  return {
    ...emptyReport(),
    glyph: "∅",
    status: "neither",
    verified: false,
    canApply: false,
    previewDiff: "--- a\n+++ b\n+vy:+1\n",
    blockReason: "∅: Auto-Apply bloqueado; puedes Aceptar a mano",
    unverifiedReason: "propuesta no verificada: identificador ASCII/Latin libre",
    ...partial,
  };
}

describe("buildReviewChrome", () => {
  it("con review exige Aceptar y Rechazar visibles", () => {
    const chrome = buildReviewChrome({ report: report({}) }, null);
    expect(chrome).not.toBeNull();
    expect(chrome?.showAccept).toBe(true);
    expect(chrome?.showReject).toBe(true);
    expect(chrome?.showUndo).toBe(false);
    expect(chrome?.notice).toMatch(/Aceptar|rechaza|diff/i);
    expect(chrome?.warnUnverified).toBe(true);
    expect(chrome?.showAccept).toBe(true);
  });

  it("un cambio verificado no muestra el aviso y Aceptar sigue", () => {
    const chrome = buildReviewChrome({ report: report({ verified: true, glyph: "⊤" }) }, null);
    expect(chrome?.warnUnverified).toBe(false);
    expect(chrome?.showAccept).toBe(true);
  });

  it("tras Accept con backup muestra Deshacer en la misma barra", () => {
    const chrome = buildReviewChrome(null, {
      backupPath: ".bara-backup/stamp/hELLO.bara.bak",
    });
    expect(chrome?.showAccept).toBe(false);
    expect(chrome?.showReject).toBe(false);
    expect(chrome?.showUndo).toBe(true);
    expect(chrome?.undoLabel).toContain(".bara-backup/");
  });

  it("review + backup: las tres acciones", () => {
    const chrome = buildReviewChrome(
      { report: report({}) },
      { backupPath: ".bara-backup/x.bak" },
    );
    expect(chrome?.showAccept).toBe(true);
    expect(chrome?.showReject).toBe(true);
    expect(chrome?.showUndo).toBe(true);
  });

  it("sin review ni backup → null", () => {
    expect(buildReviewChrome(null, null)).toBeNull();
  });

  it("mapBlock oculta Aceptar", () => {
    const chrome = buildReviewChrome(
      { report: report({}), mapBlock: "import roto" },
      null,
    );
    expect(chrome?.showAccept).toBe(false);
    expect(chrome?.showReject).toBe(true);
  });
});

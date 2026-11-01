import { describe, expect, it } from "vitest";

import type { AutoApplyReport } from "./autoApply";
import { emptyReport } from "./autoApply";
import {
  NEED_BARA_FILE,
  isActiveBaraPath,
  proposeFromJudge,
  reviewNotice,
} from "./proposePatch";

function report(partial: Partial<AutoApplyReport>): AutoApplyReport {
  return {
    ...emptyReport(),
    glyph: "⊤",
    status: "true",
    path: "hELLO.bara",
    line: 1,
    verified: true,
    unverifiedReason: "",
    previewDiff: "--- a\n+++ b\n+ברא\n",
    canApply: true,
    judgmentId: "tok",
    ...partial,
  };
}

describe("isActiveBaraPath", () => {
  it("acepta .bara y rechaza placeholders", () => {
    expect(isActiveBaraPath("hELLO.bara")).toBe(true);
    expect(isActiveBaraPath("<editor>")).toBe(false);
    expect(isActiveBaraPath(null)).toBe(false);
  });
});

describe("proposeFromJudge", () => {
  it("sin archivo pide abrir .bara", () => {
    const outcome = proposeFromJudge("ברא", report({}), false);
    expect(outcome.kind).toBe("need_file");
    if (outcome.kind === "need_file") {
      expect(outcome.notice).toBe(NEED_BARA_FILE);
    }
  });

  it("⊤ verificado abre review", () => {
    const outcome = proposeFromJudge("ברא", report({}), true);
    expect(outcome.kind).toBe("review");
    if (outcome.kind === "review") {
      expect(outcome.report.previewDiff.length).toBeGreaterThan(0);
      expect(outcome.report.canApply).toBe(true);
    }
  });

  it("no verificado / ∅ con diff abre review (flujo manual)", () => {
    const outcome = proposeFromJudge(
      "vy:+1",
      report({
        status: "neither",
        glyph: "∅",
        canApply: false,
        verified: false,
        unverifiedReason: "propuesta no verificada: identificador ASCII/Latin libre",
        previewDiff: "--- a\n+++ b\n+vy:+1\n",
        blockReason: "∅: Auto-Apply bloqueado; puedes Aceptar a mano",
      }),
      true,
    );
    expect(outcome.kind).toBe("review");
    if (outcome.kind === "review") {
      expect(outcome.report.previewDiff).toContain("vy:+1");
      expect(outcome.report.canApply).toBe(false);
      expect(outcome.report.verified).toBe(false);
    }
  });

  it("sin previewDiff queda blocked", () => {
    const outcome = proposeFromJudge(
      "x",
      report({ previewDiff: "", canApply: false, blockReason: "sin diff" }),
      true,
    );
    expect(outcome.kind).toBe("blocked");
  });

  it("veto sin diff bloquea", () => {
    const outcome = proposeFromJudge(
      "fn {",
      report({ status: "both", glyph: "⊤∧⊥", previewDiff: "", canApply: false }),
      true,
    );
    expect(outcome.kind).toBe("blocked");
  });
});

describe("reviewNotice", () => {
  it("menciona Auto-Apply bloqueado si no está verificado", () => {
    const text = reviewNotice(
      report({
        verified: false,
        canApply: false,
        blockReason: "",
        unverifiedReason: "identificador ASCII/Latin libre",
      }),
    );
    expect(text).toMatch(/Aceptar|rechaza/i);
    expect(text).toMatch(/ASCII|Auto-Apply|no verificad/i);
  });
});

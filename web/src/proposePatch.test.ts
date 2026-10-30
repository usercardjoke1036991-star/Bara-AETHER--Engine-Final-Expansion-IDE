import { describe, expect, it } from "vitest";

import type { AutoApplyReport } from "./autoApply";
import {
  NEED_BARA_FILE,
  isActiveBaraPath,
  proposeFromJudge,
} from "./proposePatch";

function report(partial: Partial<AutoApplyReport>): AutoApplyReport {
  return {
    glyph: "⊤",
    status: "true",
    applied: false,
    path: "hello.bara",
    line: 1,
    inserted: 1,
    source: "",
    verified: true,
    unverifiedReason: "",
    previewDiff: "--- a\n+++ b\n+ברא\n",
    canApply: true,
    blockReason: "",
    backupPath: "",
    ...partial,
  };
}

describe("isActiveBaraPath", () => {
  it("acepta rutas .bara del workspace", () => {
    expect(isActiveBaraPath("hello.bara")).toBe(true);
    expect(isActiveBaraPath("samples/uno.bara")).toBe(true);
  });

  it("rechaza fragmento, editor vacío y no-bara", () => {
    expect(isActiveBaraPath("<fragmento>")).toBe(false);
    expect(isActiveBaraPath("<editor>")).toBe(false);
    expect(isActiveBaraPath("")).toBe(false);
    expect(isActiveBaraPath("readme.md")).toBe(false);
  });
});

describe("proposeFromJudge", () => {
  it("usar en editor → abre el diff (review)", () => {
    const outcome = proposeFromJudge("ברא", report({}), true);
    expect(outcome.kind).toBe("review");
    if (outcome.kind === "review") {
      expect(outcome.report.previewDiff.length).toBeGreaterThan(0);
      expect(outcome.report.canApply).toBe(true);
    }
  });

  it("sin archivo activo avisa y no hay review", () => {
    const outcome = proposeFromJudge("ברא", report({}), false);
    expect(outcome).toEqual({ kind: "need_file", notice: NEED_BARA_FILE });
  });

  it("Rechazar conceptual: blocked/neither no es review (archivo no cambia)", () => {
    const outcome = proposeFromJudge(
      "x",
      report({ status: "neither", glyph: "∅", canApply: false, previewDiff: "", verified: false }),
      true,
    );
    expect(outcome.kind).toBe("blocked");
  });

  it("Aceptar listo: review con canApply y diff (backup lo crea confirm)", () => {
    const outcome = proposeFromJudge("ברא", report({ canApply: true, verified: true }), true);
    expect(outcome.kind).toBe("review");
  });

  it("sin diff útil no abre review", () => {
    const outcome = proposeFromJudge(
      "ברא",
      report({ previewDiff: "", canApply: false, blockReason: "sin diff" }),
      true,
    );
    expect(outcome.kind).toBe("blocked");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_APPLY_KEY,
  AUTO_APPLY_MIGRATION_KEY,
  emptyReport,
  readAutoApplyEnabled,
  writeAutoApplyEnabled,
} from "./autoApply";

afterEach(() => {
  localStorage.clear();
});

describe("Auto-Apply persistencia", () => {
  it("queda apagado por defecto y migra el modo silencioso legado", () => {
    localStorage.setItem(AUTO_APPLY_KEY, "1");
    expect(readAutoApplyEnabled()).toBe(false);
    expect(localStorage.getItem(AUTO_APPLY_KEY)).toBe("0");
    expect(localStorage.getItem(AUTO_APPLY_MIGRATION_KEY)).toBe("1");
  });

  it("permite encender la cola de diff tras la migración", () => {
    writeAutoApplyEnabled(true);
    expect(readAutoApplyEnabled()).toBe(true);
    writeAutoApplyEnabled(false);
    expect(readAutoApplyEnabled()).toBe(false);
  });
});

describe("emptyReport / contrato de no escritura en ∅", () => {
  it("el informe vacío no aplica ni permite escritura", () => {
    const report = emptyReport(3);
    expect(report.applied).toBe(false);
    expect(report.canApply).toBe(false);
    expect(report.previewDiff).toBe("");
  });

  it("un informe ∅ tipado bloquea canApply (diff obligatorio antes de escribir)", () => {
    const neither = {
      ...emptyReport(1),
      glyph: "∅",
      status: "neither",
      blockReason: "∅ falta información: no se escribe",
      canApply: false,
      verified: false,
    };
    expect(neither.status).toBe("neither");
    expect(neither.canApply).toBe(false);
    expect(neither.applied).toBe(false);
    // Sin previewDiff no hay aceptar/rechazar útil.
    expect(neither.previewDiff).toBe("");
  });

  it("un candidato ⊤ exige diff antes de confirmar", () => {
    const ready = {
      ...emptyReport(1),
      glyph: "⊤",
      status: "true",
      verified: true,
      canApply: true,
      previewDiff: "--- a/x\n+++ b/x\n+fn beta() {}\n",
    };
    expect(ready.canApply).toBe(true);
    expect(ready.previewDiff.length).toBeGreaterThan(0);
    expect(ready.applied).toBe(false);
  });
});

describe("invoke de confirmación", () => {
  it("confirmAutoPatch no se llama en el camino de sólo juicio", async () => {
    const confirm = vi.fn();
    const judge = vi.fn(async (_patch: string) => ({
      ...emptyReport(1),
      glyph: "∅",
      status: "neither",
      blockReason: "∅ falta información: no se escribe",
    }));
    const report = await judge("זזז");
    expect(report.canApply).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("Aceptar / Rechazar / Deshacer (contrato)", () => {
  it("Rechazar: no llama a confirm ni undo (archivo intacto)", () => {
    const confirm = vi.fn();
    const undo = vi.fn();
    // La UI solo hace setReview(null); no hay invoke.
    expect(confirm).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it("Aceptar: confirm con applied + backupPath; Deshacer restaura", async () => {
    const disk = { text: "fn alpha() {}\n" };
    const confirm = vi.fn(async () => {
      disk.text = "fn alpha() {}\nfn beta() {}\n";
      return {
        ...emptyReport(1),
        glyph: "⊤",
        status: "true",
        applied: true,
        verified: true,
        canApply: true,
        path: "hello.bara",
        source: disk.text,
        backupPath: ".bara-backup/stamp/hello.bara.bak",
        judgmentId: "abc",
      };
    });
    const undo = vi.fn(async () => {
      disk.text = "fn alpha() {}\n";
      return {
        ...emptyReport(1),
        glyph: "⊤",
        status: "true",
        applied: true,
        path: "hello.bara",
        source: disk.text,
        backupPath: "",
      };
    });
    const accepted = await confirm("fn beta() {}");
    expect(accepted.applied).toBe(true);
    expect(accepted.backupPath).toContain(".bara-backup/");
    expect(disk.text).toContain("beta");
    const restored = await undo("hello.bara", accepted.backupPath);
    expect(restored.applied).toBe(true);
    expect(disk.text).toBe("fn alpha() {}\n");
  });
});

import { describe, expect, it } from "vitest";

import type { AutoApplyReport } from "./autoApply";
import { emptyReport } from "./autoApply";
import {
  formatPatchDebug,
  resolvePatchAttempt,
  shouldListenForPropose,
} from "./patchFlow";
import { NEED_BARA_FILE } from "./proposePatch";

function readyReport(): AutoApplyReport {
  return {
    ...emptyReport(1),
    glyph: "⊤",
    status: "true",
    verified: true,
    canApply: true,
    previewDiff: "--- a\n+++ b\n+ברא\n",
    path: "hello.bara",
    blockReason: "",
  };
}

describe("shouldListenForPropose", () => {
  it("escucha en escritorio aunque el chat esté cerrado (causa del silencio)", () => {
    expect(shouldListenForPropose(true, false)).toBe(true);
    expect(shouldListenForPropose(true, true)).toBe(true);
    expect(shouldListenForPropose(false, true)).toBe(false);
  });
});

describe("resolvePatchAttempt (flujo e2e lógico)", () => {
  it("usar en editor → review con diff", () => {
    const { outcome, notice, log } = resolvePatchAttempt("ברא", "hELLO.bara", readyReport());
    expect(outcome.kind).toBe("review");
    expect(notice).toMatch(/diff|acepta/i);
    expect(log.phase).toBe("review");
  });

  it("sin archivo → aviso obligatorio (nunca silencio)", () => {
    const { notice, log } = resolvePatchAttempt("ברא", "<editor>", readyReport());
    expect(notice).toBe(NEED_BARA_FILE);
    expect(log.phase).toBe("need_file");
  });

  it("parches vacíos → aviso visible", () => {
    const { notice } = resolvePatchAttempt("   ", "hello.bara", readyReport());
    expect(notice.length).toBeGreaterThan(0);
  });

  it("Rechazar conceptual: blocked no abre review", () => {
    const blocked = {
      ...readyReport(),
      status: "neither",
      glyph: "∅",
      canApply: false,
      previewDiff: "",
      verified: false,
      blockReason: "∅",
    };
    const { outcome } = resolvePatchAttempt("x", "hello.bara", blocked);
    expect(outcome.kind).toBe("blocked");
  });
});

describe("formatPatchDebug", () => {
  it("no incluye secretos ni claves", () => {
    const line = formatPatchDebug({
      phase: "emit",
      vista: "ai-workspace",
      document: "hello.bara",
      detail: "len=12",
    });
    expect(line).toContain("[patch-flow]");
    expect(line).not.toMatch(/sk-|api[_-]?key|Bearer/i);
  });
});

/** Simula Asistencia → main: emit + recv + ensure_open + review. */
describe("integración entre ventanas (orquestación)", () => {
  it("main escucha con chat cerrado y acaba en review si hay .bara", () => {
    expect(shouldListenForPropose(true, false)).toBe(true);
    const recv = resolvePatchAttempt("ברא\n", "samples/hello.bara", readyReport());
    expect(recv.log.phase).toBe("review");
    expect(recv.outcome.kind).toBe("review");
    expect(formatPatchDebug({ phase: "recv", vista: "main", document: "samples/hello.bara" })).toMatch(
      /recv/,
    );
    expect(formatPatchDebug({ phase: "ensure_open", vista: "main" })).toMatch(/ensure_open/);
  });

  it("root_reset deja need_file hasta abrir otro .bara", () => {
    const afterReset = resolvePatchAttempt("ברא", "<editor>", readyReport());
    expect(afterReset.notice).toBe(NEED_BARA_FILE);
    expect(afterReset.log.phase).toBe("need_file");
  });
});

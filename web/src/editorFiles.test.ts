import { describe, expect, it } from "vitest";

import { editorBadge, isBaraPath, isEditorPath } from "./editorFiles";

describe("editorFiles", () => {
  it("reconoce extensiones editables y .bara", () => {
    expect(isEditorPath("src/main.rs")).toBe(true);
    expect(isEditorPath("web/App.tsx")).toBe(true);
    expect(isEditorPath("README.md")).toBe(true);
    expect(isEditorPath("secret.bin")).toBe(false);
    expect(isBaraPath("samples/genesis.bara")).toBe(true);
    expect(isBaraPath("src/main.rs")).toBe(false);
  });

  it("badge verificado solo en .bara; equilibrado en otros", () => {
    expect(editorBadge("doc.bara", { verified: true })).toBe("verificado");
    expect(editorBadge("doc.bara", { verified: false })).toBe("no verificado");
    expect(editorBadge("doc.bara", { verified: null })).toBe("sin análisis");
    expect(editorBadge("main.rs", { verified: null })).toBe("equilibrado");
    expect(editorBadge("main.rs", { verified: false, clash: true })).toBe("sin choque");
  });
});

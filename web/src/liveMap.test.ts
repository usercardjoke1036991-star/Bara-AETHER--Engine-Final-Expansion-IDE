import { describe, expect, it } from "vitest";

import { filesFromUnifiedDiff, isExternalJsSpecifier, mergeUnifiedDiff, spliceHost } from "./liveMap";

describe("spliceHost", () => {
  it("inserta el parche en la línea pedida", () => {
    const host = "fn a() {}\nfn b() {}\n";
    const next = spliceHost(host, "use crate::missing;\n", 1);
    expect(next.startsWith("use crate::missing;")).toBe(true);
    expect(next).toContain("fn a() {}");
  });

  it("al final si la línea supera el archivo", () => {
    const host = "a\nb\n";
    expect(spliceHost(host, "c", 99)).toBe("a\nb\nc\n");
  });
});

describe("filesFromUnifiedDiff", () => {
  it("reconstruye un lote de más de un archivo", () => {
    const diff = [
      "diff --git a/src/a.rs b/src/a.rs",
      "--- a/src/a.rs",
      "+++ b/src/a.rs",
      "+fn a() {}",
      "diff --git a/src/b.py b/src/b.py",
      "--- a/src/b.py",
      "+++ b/src/b.py",
      "+def b():",
      "+    return 1",
    ].join("\n");
    const files = filesFromUnifiedDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0]?.path).toBe("src/a.rs");
    expect(files[0]?.source).toContain("fn a()");
    expect(files[1]?.path).toBe("src/b.py");
    expect(files[1]?.source).toContain("return 1");
  });
});

describe("mergeUnifiedDiff", () => {
  it("un hunk parcial conserva el resto del host y no escribe el recorte", () => {
    const host = "keep-head\nalpha\nkeep-tail\n";
    const diff = [
      "diff --git a/src/a.rs b/src/a.rs",
      "--- a/src/a.rs",
      "+++ b/src/a.rs",
      "@@ -2,1 +2,1 @@",
      "-alpha",
      "+beta",
      "diff --git a/src/b.rs b/src/b.rs",
      "--- a/src/b.rs",
      "+++ b/src/b.rs",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const merged = mergeUnifiedDiff(diff, {
      "src/a.rs": host,
      "src/b.rs": "old\n",
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) {
      return;
    }
    expect(merged.files[0]?.source).toBe("keep-head\nbeta\nkeep-tail\n");
    expect(merged.files[0]?.source).not.toBe("beta\n");
    expect(merged.files[1]?.source).toBe("new\n");
  });

  it("si el hunk no encaja, no devuelve el source truncado", () => {
    const diff = [
      "diff --git a/src/a.rs b/src/a.rs",
      "--- a/src/a.rs",
      "+++ b/src/a.rs",
      "@@ -2,1 +2,1 @@",
      "-alpha",
      "+beta",
      "diff --git a/src/b.rs b/src/b.rs",
      "--- a/src/b.rs",
      "+++ b/src/b.rs",
      "+solo esto",
    ].join("\n");
    const merged = mergeUnifiedDiff(diff, {
      "src/a.rs": "keep-head\notra\nkeep-tail\n",
      "src/b.rs": "archivo entero que no debe perderse\n",
    });
    expect(merged.ok).toBe(false);
    if (merged.ok) {
      return;
    }
    expect(merged.reason).toMatch(/no se escribe/i);
    expect(merged.reason).not.toContain("beta\n");
  });
});

describe("isExternalJsSpecifier", () => {
  it("trata @tauri-apps y bare como externos", () => {
    expect(isExternalJsSpecifier("@tauri-apps/api/core")).toBe(true);
    expect(isExternalJsSpecifier("react")).toBe(true);
    expect(isExternalJsSpecifier("./local")).toBe(false);
    expect(isExternalJsSpecifier("../x")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { isExternalJsSpecifier, spliceHost } from "./liveMap";

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

describe("isExternalJsSpecifier", () => {
  it("trata @tauri-apps y bare como externos", () => {
    expect(isExternalJsSpecifier("@tauri-apps/api/core")).toBe(true);
    expect(isExternalJsSpecifier("react")).toBe(true);
    expect(isExternalJsSpecifier("./local")).toBe(false);
    expect(isExternalJsSpecifier("../x")).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dedupeTreeByPathKey,
  normalizeWorkspacePath,
  pathKey,
  pathsEqual,
} from "./paths";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pathsEqual / pathKey (Windows)", () => {
  it("iguala Hello.bara y hELLO.bara en win32", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(pathsEqual("Hello.bara", "hELLO.bara")).toBe(true);
    expect(pathsEqual("samples/Hello.bara", "samples/hELLO.bara")).toBe(true);
    expect(pathKey("Hello.bara")).toBe("hello.bara");
  });

  it("normaliza barras", () => {
    expect(normalizeWorkspacePath("a\\b\\c.bara")).toBe("a/b/c.bara");
  });
});

describe("dedupeTreeByPathKey", () => {
  it("elimina duplicados sólo por mayúsculas", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    const tree = dedupeTreeByPathKey([
      { path: "Hello.bara", kind: "file" },
      { path: "hELLO.bara", kind: "file" },
      { path: "other.bara", kind: "file" },
    ]);
    expect(tree.map((e) => e.path)).toEqual(["Hello.bara", "other.bara"]);
  });
});

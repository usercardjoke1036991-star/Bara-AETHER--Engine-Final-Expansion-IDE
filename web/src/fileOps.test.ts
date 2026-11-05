import { describe, expect, it } from "vitest";

import { confirmDeletePath } from "./fileOps";

describe("confirmDeletePath", () => {
  it("exige confirmación explícita antes de borrar", () => {
    const messages: string[] = [];
    const ask = (message: string): boolean => {
      messages.push(message);
      return false;
    };
    expect(confirmDeletePath("src/main.rs", ask)).toBe(false);
    expect(messages[0]).toContain("src/main.rs");
    expect(messages[0]).toMatch(/Borrar/i);

    expect(confirmDeletePath("nota.md", () => true)).toBe(true);
  });
});

// @vitest-environment node
// Guarda estructural del workflow: el paso muerto no tiene comportamiento en runtime.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("workflow de CI", () => {
  it("no finge autenticar un kernel privado", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const workflow = readFileSync(join(root, ".github", "workflows", "rust.yml"), "utf8");
    expect(workflow).not.toContain("repo privado del kernel");
    expect(workflow).not.toContain("git credential rewrite activo");
    expect(workflow).not.toContain("KERNEL_READ_TOKEN");
    expect(workflow).toContain("cargo test --locked --verbose");
  });
});

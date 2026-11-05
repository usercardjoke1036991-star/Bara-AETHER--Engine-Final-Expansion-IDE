// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("inventario del escritorio", () => {
  it("declara 0.5.0 y no trata el workspace padre como CI", () => {
    const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
    expect(cargo).toContain('version = "0.5.0"');
    expect(cargo).toContain("contenedor local, no CI");
    expect(cargo).not.toContain("miembro del workspace raíz");
    const inventory = readFileSync(join(root, "docs", "INVENTARIO.md"), "utf8");
    expect(inventory).toContain("`bara-ide-desktop` v0.5.0");
    const tauriLine = inventory.split("\n").find((line) => line.includes("`tauri.conf.json`"));
    expect(tauriLine).toContain("v0.5.0");
    expect(tauriLine).not.toContain("v0.1.0");
  });
});

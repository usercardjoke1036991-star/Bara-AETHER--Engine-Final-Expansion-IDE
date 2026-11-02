import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * B11 — los listeners async de DeskWindows deben guardar bandera `alive`
 * y limpiarla en el cleanup (evita setState tras unmount).
 */
describe("DeskWindows listeners alive", () => {
  it("declara alive + cleanup en efectos con onEditorContext / listen", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "DeskWindows.tsx"), "utf8");
    const aliveCount = (source.match(/\balive\b/g) ?? []).length;
    expect(aliveCount).toBeGreaterThanOrEqual(6);
    expect(source).toMatch(/alive = false/);
    expect(source).toMatch(/onEditorContext/);
    expect(source).toMatch(/if \(alive\)/);
  });
});

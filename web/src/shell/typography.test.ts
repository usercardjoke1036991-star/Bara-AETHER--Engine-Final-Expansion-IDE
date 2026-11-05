// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";
import { describe, expect, it } from "vitest";

import editorSource from "../components/BaraEditor.tsx?raw";

/** La hoja que Vite incluye. La raíz es 14 px, así que 1 rem = 14 px. */
const ROOT_PX = 14;

function pixels(value: string): number | null {
  const token = value.trim().replace(/;$/, "");
  if (token === "var(--font-min)") {
    return ROOT_PX;
  }
  const match = /^(\d*\.?\d+)(rem|px|em)$/.exec(token);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (match[2] === "px") {
    return amount;
  }
  return amount * ROOT_PX;
}

function declarations(source: string): string[] {
  return [...source.matchAll(/font-size:\s*([^;}\n]+)/g)].map((hit) => hit[1] ?? "");
}

describe("tipografía legible", () => {
  it("el CSS que empaqueta Vite no baja de 14 px", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../styles.css"), "utf8");
    const compiled = await transform(source, { loader: "css", minify: true });
    const css = compiled.code;
    expect(css).toMatch(/--font-min:\s*14px/);
    expect(css).not.toMatch(/--font-min:\s*1[0-3]px/);
    expect(css).toMatch(/font-size:\s*var\(--font-min\)/);
    const small = declarations(css).filter((value) => {
      const px = pixels(value);
      return px !== null && px < 14;
    });
    expect(small).toEqual([]);
  });

  it("el editor usa 14 px", () => {
    expect(editorSource).toContain('fontSize: "14px"');
    expect(editorSource).not.toContain('fontSize: "13px"');
  });
});

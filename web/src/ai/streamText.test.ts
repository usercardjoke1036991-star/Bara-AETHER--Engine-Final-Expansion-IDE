import { describe, expect, it } from "vitest";

import { streamTextToUi } from "./streamText";
import { MAX_READS_PER_TURN, wrapFileDataPayload } from "./tools";

describe("streamTextToUi + anti-inyección", () => {
  it("emite deltas y cancel no completa", async () => {
    const parts: string[] = [];
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamTextToUi("abcdefghij", (partial) => parts.push(partial), controller.signal, 3),
    ).rejects.toBeTruthy();
    // Abort inmediato: no debe devolver el texto completo como éxito.
    expect(parts.join("").includes("abcdefghij")).toBe(false);
  });

  it("streaming completa el texto si no hay cancel", async () => {
    const parts: string[] = [];
    const full = await streamTextToUi("hola", (partial) => parts.push(partial), undefined, 2);
    expect(full).toBe("hola");
    expect(parts.at(-1)).toBe("hola");
  });

  it("marca datos de archivo y limita lecturas", () => {
    const wrapped = wrapFileDataPayload("src/a.rs", "fn main() {}");
    expect(wrapped).toContain("[DATOS_ARCHIVO path=src/a.rs]");
    expect(wrapped).toContain("[/DATOS_ARCHIVO]");
    expect(wrapped).toMatch(/no son instrucciones/i);
    expect(MAX_READS_PER_TURN).toBe(3);
  });
});

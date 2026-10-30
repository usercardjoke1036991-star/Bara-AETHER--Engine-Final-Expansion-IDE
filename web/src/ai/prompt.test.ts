import { describe, expect, it } from "vitest";

import { excerpt, MAX_DOCUMENT_CHARS, baraSystemPrompt } from "./prompt";

describe("excerpt", () => {
  it("no recorta por debajo del tope", () => {
    expect(excerpt("abc", 10)).toBe("abc");
  });

  it("recorta caracteres Unicode sin partir el texto", () => {
    const source = "א".repeat(MAX_DOCUMENT_CHARS + 5);
    const cut = excerpt(source);
    expect(cut.startsWith("א".repeat(MAX_DOCUMENT_CHARS))).toBe(true);
    expect(cut).toContain("extracto recortado");
    expect(cut).toContain("5 caracteres omitidos");
  });
});

describe("baraSystemPrompt", () => {
  it("exige catálogo real y etiqueta de no verificado", () => {
    const prompt = baraSystemPrompt({
      catalogue: [{ glyph: "ברא", meaning: "manifestar" }],
      sample: "ברא\n",
      documentName: "demo.bara",
      documentSource: "ברא\n",
      analysis: null,
    });
    expect(prompt).toContain("ברא");
    expect(prompt).toContain("propuesta no verificada");
    expect(prompt).toContain("catálogo");
  });
});

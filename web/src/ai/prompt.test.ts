import { describe, expect, it } from "vitest";

import {
  LEXER_OPERATORS,
  MAX_DOCUMENT_CHARS,
  baraSystemPrompt,
  estimateTokens,
  excerpt,
  needsCodeContext,
  promptBudgetParts,
  summarizeBudget,
} from "./prompt";

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
      userText: "modifica el archivo demo",
    });
    expect(prompt).toContain("ברא");
    expect(prompt).toContain("propuesta no verificada");
    expect(prompt).toContain("Catálogo");
    for (const op of LEXER_OPERATORS) {
      expect(prompt).toContain(op);
    }
  });

  it("un Hola omite documento y queda bajo 3000 tokens estimados", () => {
    const catalogue = Array.from({ length: 40 }, (_, i) => ({
      glyph: `אבג`,
      meaning: `sentido-${i}`,
    }));
    const tree = Array.from({ length: 200 }, (_, i) => `src/f${i}.bara`).join("\n");
    const parts = promptBudgetParts({
      catalogue,
      sample: "ברא ".repeat(500),
      documentName: "huge.bara",
      documentSource: "x".repeat(20_000),
      analysis: null,
      treeOutline: tree,
      userText: "Hola",
    });
    const budget = summarizeBudget(parts);
    const prompt = baraSystemPrompt({
      catalogue,
      sample: "ברא ".repeat(500),
      documentName: "huge.bara",
      documentSource: "x".repeat(20_000),
      analysis: null,
      treeOutline: tree,
      userText: "Hola",
    });
    expect(needsCodeContext("Hola")).toBe(false);
    expect(prompt).not.toContain("huge.bara");
    expect(budget.totalTokensEst).toBeLessThan(3000);
    expect(estimateTokens(prompt)).toBeLessThan(3000);
  });
});

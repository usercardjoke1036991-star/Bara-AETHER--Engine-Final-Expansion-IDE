import { describe, expect, it } from "vitest";

import type { Analysis } from "./engine";
import { problemsFromAnalysis, unclosedString } from "./problems";

function analysisWith(tokens: Analysis["tokens"]): Analysis {
  return {
    sourceChars: 10,
    sourceLines: 2,
    tokens,
    summary: {
      total: tokens.length,
      rootsKnown: 0,
      rootsUnknown: tokens.filter((t) => t.class === "rootUnknown").length,
      identifiers: tokens.filter((t) => t.class === "identifier").length,
      numbers: 0,
      strings: 0,
      punctuation: 0,
      newlines: 0,
      eof: 0,
    },
    roots: [],
  };
}

describe("problemsFromAnalysis", () => {
  it("emite identificador sin raíz y salta a línea/columna", () => {
    const problems = problemsFromAnalysis(
      analysisWith([
        {
          line: 3,
          column: 5,
          class: "identifier",
          lexeme: "foo",
          display: "foo",
          glyph: null,
          meaning: null,
        },
      ]),
      "doc.bara",
      "ברא\n",
    );
    expect(problems[0]?.message).toMatch(/identificador sin raíz/);
    expect(problems[0]?.line).toBe(3);
    expect(problems[0]?.column).toBe(5);
    expect(problems[0]?.path).toBe("doc.bara");
  });

  it("detecta cadena sin cerrar", () => {
    expect(unclosedString('hola "mundo')).toEqual({ line: 1, column: 6 });
    const problems = problemsFromAnalysis(null, "x.bara", 'a "b');
    expect(problems.some((p) => p.message === "cadena sin cerrar")).toBe(true);
  });
});

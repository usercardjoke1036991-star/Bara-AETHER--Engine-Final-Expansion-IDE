import { describe, expect, it } from "vitest";

import { statusFromAnalysis, type BaraVerifyStatus } from "./baraVerify";
import type { Analysis } from "./engine";

function analysis(partial: {
  rootsKnown?: number;
  rootsUnknown?: number;
  identifiers?: number;
}): Analysis {
  return {
    sourceChars: 1,
    sourceLines: 1,
    tokens: [],
    roots: [],
    summary: {
      total: 1,
      rootsKnown: partial.rootsKnown ?? 0,
      rootsUnknown: partial.rootsUnknown ?? 0,
      identifiers: partial.identifiers ?? 0,
      numbers: 0,
      strings: 0,
      punctuation: 0,
      newlines: 0,
      eof: 0,
    },
  };
}

describe("baraVerify statusFromAnalysis", () => {
  it("verificado cuando hay raíces conocidas y sin ASCII libre", () => {
    const status: BaraVerifyStatus = statusFromAnalysis(
      analysis({ rootsKnown: 2, rootsUnknown: 0, identifiers: 0 }),
    );
    expect(status).toBe("verified");
  });

  it("no verificado con raíces desconocidas", () => {
    expect(statusFromAnalysis(analysis({ rootsKnown: 1, rootsUnknown: 1 }))).toBe(
      "unverified",
    );
  });

  it("no verificado sin raíces conocidas", () => {
    expect(statusFromAnalysis(analysis({ rootsKnown: 0 }))).toBe("unverified");
  });

  it("no verificado con identificadores ASCII/Latin", () => {
    expect(
      statusFromAnalysis(analysis({ rootsKnown: 3, rootsUnknown: 0, identifiers: 1 })),
    ).toBe("unverified");
  });
});

import { describe, expect, it } from "vitest";

import { codeBlocks, firstBaraCodeBlock } from "./AssistantText";

describe("B7 firstBaraCodeBlock", () => {
  it("ignora el primer fence si no es bara", () => {
    const md = ["```ts", "const x = 1", "```", "", "```bara", "אמר", "```"].join("\n");
    expect(codeBlocks(md)[0]).toBe("const x = 1");
    expect(firstBaraCodeBlock(md)).toBe("אמר");
  });

  it("devuelve null si no hay fence bara", () => {
    const md = ["```json", "{\"a\":1}", "```"].join("\n");
    expect(firstBaraCodeBlock(md)).toBeNull();
  });

  it("toma el primer fence bara aunque haya otro después", () => {
    const md = ["```bara", "uno", "```", "```bara", "dos", "```"].join("\n");
    expect(firstBaraCodeBlock(md)).toBe("uno");
  });

  it("acepta etiqueta BARA en mayúsculas", () => {
    const md = ["```BARA", "raíz", "```"].join("\n");
    expect(firstBaraCodeBlock(md)).toBe("raíz");
  });
});

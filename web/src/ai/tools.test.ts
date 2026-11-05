import { describe, expect, it } from "vitest";

import { parseOpenAiResponse, parseOpenAiToolCalls } from "./providers";
import {
  READ_FILE_TOOL,
  TOOL_LEAK_NOTICE,
  parseToolLeakAsCalls,
  sanitizeAssistantText,
} from "./tools";

describe("parseOpenAiToolCalls", () => {
  it("extrae tool_calls nativos de una respuesta simulada", () => {
    const payload = {
      model: "deepseek-chat",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: READ_FILE_TOOL,
                  arguments: JSON.stringify({ path: "hello.bara" }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const result = parseOpenAiResponse(payload);
    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: READ_FILE_TOOL,
        arguments: JSON.stringify({ path: "hello.bara" }),
      },
    ]);
    expect(parseOpenAiToolCalls(payload.choices[0].message.tool_calls)).toHaveLength(1);
  });
});

describe("DSML / fugas de markup", () => {
  const dsml = `<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="leer archivo"><｜｜DSML｜｜ parameter name="path" string="true">hELLO.bara</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>`;

  it("parsea DSML en texto como llamada leer_archivo", () => {
    const calls = parseToolLeakAsCalls(dsml);
    expect(calls).not.toBeNull();
    expect(calls![0].name).toBe(READ_FILE_TOOL);
    expect(JSON.parse(calls![0].arguments)).toEqual({ path: "hELLO.bara" });
  });

  it("oculta DSML crudo al usuario", () => {
    const cleaned = sanitizeAssistantText(dsml);
    expect(cleaned).toBe(TOOL_LEAK_NOTICE);
    expect(cleaned).not.toMatch(/DSML/i);
    expect(cleaned).not.toContain("hELLO.bara");
  });

  it("parsea <tool_call> con path", () => {
    const xml = `<tool_call>
name: leer_archivo
arguments: {"path":"samples/uno.bara"}
</tool_call>`;
    const calls = parseToolLeakAsCalls(xml);
    expect(calls?.[0].name).toBe(READ_FILE_TOOL);
    expect(JSON.parse(calls![0].arguments).path).toBe("samples/uno.bara");
  });
});

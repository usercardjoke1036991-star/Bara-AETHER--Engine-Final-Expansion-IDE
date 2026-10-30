import { describe, expect, it, vi } from "vitest";

import { buildCommands, filterCommands, type CommandHandlers } from "./commands";
import { bottomHeightCss, isNestedScrollViolation, nextEscTarget } from "./uxRules";

function handlers(): CommandHandlers {
  return {
    toggleSide: vi.fn(),
    toggleChat: vi.fn(),
    toggleBottom: vi.fn(),
    openBottomTab: vi.fn(),
    openPalette: vi.fn(),
    openAssistMedia: vi.fn(),
    save: vi.fn(),
    openFolder: vi.fn(),
    focusEditor: vi.fn(),
    maximizeBottom: vi.fn(),
    minimizeBottom: vi.fn(),
    closeBottom: vi.fn(),
    closeMenus: vi.fn(),
  };
}

describe("paleta de comandos", () => {
  it("incluye acciones en español y filtra por nombre", () => {
    const cmds = buildCommands(handlers());
    expect(cmds.length).toBeGreaterThan(15);
    expect(cmds.some((c) => /paleta/i.test(c.label))).toBe(true);
    expect(cmds.some((c) => /chat/i.test(c.label))).toBe(true);
    expect(filterCommands(cmds, "oráculo").some((c) => /Oráculo/i.test(c.label))).toBe(true);
    expect(filterCommands(cmds, "zzzz-inexistente")).toHaveLength(0);
  });
});

describe("reglas UX", () => {
  it("detecta scroll anidado prohibido", () => {
    expect(isNestedScrollViolation("auto", "scroll")).toBe(true);
    expect(isNestedScrollViolation("hidden", "auto")).toBe(false);
    expect(isNestedScrollViolation("visible", "visible")).toBe(false);
  });

  it("Esc cierra en cascada menú → paleta → abajo → chat → lateral", () => {
    expect(
      nextEscTarget({
        menuOpen: true,
        paletteOpen: true,
        bottomOpen: true,
        chatOpen: true,
        sideOpen: true,
      }),
    ).toBe("menu");
    expect(
      nextEscTarget({
        menuOpen: false,
        paletteOpen: true,
        bottomOpen: true,
        chatOpen: true,
        sideOpen: true,
      }),
    ).toBe("palette");
    expect(
      nextEscTarget({
        menuOpen: false,
        paletteOpen: false,
        bottomOpen: true,
        chatOpen: true,
        sideOpen: true,
      }),
    ).toBe("bottom");
    expect(
      nextEscTarget({
        menuOpen: false,
        paletteOpen: false,
        bottomOpen: false,
        chatOpen: true,
        sideOpen: true,
      }),
    ).toBe("chat");
    expect(
      nextEscTarget({
        menuOpen: false,
        paletteOpen: false,
        bottomOpen: false,
        chatOpen: false,
        sideOpen: true,
      }),
    ).toBe("side");
    expect(
      nextEscTarget({
        menuOpen: false,
        paletteOpen: false,
        bottomOpen: false,
        chatOpen: false,
        sideOpen: false,
      }),
    ).toBe("none");
  });

  it("altura del panel inferior respeta el tope del 60%", () => {
    expect(bottomHeightCss(false, false, 0.4)).toBe("0px");
    expect(bottomHeightCss(true, true, 0.2)).toBe("60%");
    expect(bottomHeightCss(true, false, 0.9)).toBe("60.0%");
    expect(bottomHeightCss(true, false, 0.35)).toBe("35.0%");
  });
});

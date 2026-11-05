import { beforeEach, describe, expect, it } from "vitest";

import { loadPanelLayout } from "./layoutState";

beforeEach(() => {
  localStorage.clear();
});

describe("migración de paneles", () => {
  it("copia bara.panels.v1 a v2 sin perder la configuración", () => {
    localStorage.setItem(
      "bara.panels.v1",
      JSON.stringify({
        sideMode: "settings",
        chatOpen: false,
        bottomOpen: true,
        bottomMaximized: true,
        bottomFrac: 0.4,
        sideFrac: 0.22,
        chatFrac: 0.4,
        bottomTab: "oraculo",
      }),
    );
    const layout = loadPanelLayout();
    expect(layout.sideMode).toBe("settings");
    expect(layout.chatOpen).toBe(false);
    expect(layout.bottomOpen).toBe(true);
    expect(layout.bottomMaximized).toBe(true);
    expect(layout.bottomFrac).toBe(0.4);
    expect(layout.sideFrac).toBe(0.22);
    expect(layout.chatFrac).toBe(0.4);
    expect(layout.bottomTab).toBe("oraculo");
    const stored = JSON.parse(localStorage.getItem("bara.panels.v2") ?? "{}") as {
      bottomTab?: string;
      sideMode?: string;
    };
    expect(stored.bottomTab).toBe("oraculo");
    expect(stored.sideMode).toBe("settings");
    expect(localStorage.getItem("bara.panels.v1")).toContain("oraculo");
  });
});

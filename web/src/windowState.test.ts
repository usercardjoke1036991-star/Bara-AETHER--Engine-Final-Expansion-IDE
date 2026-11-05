import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  maximize: vi.fn(async () => undefined),
  onResized: vi.fn(async () => undefined),
  onMoved: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    maximize: api.maximize,
    setSize: vi.fn(async () => undefined),
    setPosition: vi.fn(async () => undefined),
    center: vi.fn(async () => undefined),
    isMaximized: vi.fn(async () => true),
    outerSize: vi.fn(async () => ({ width: 1366, height: 768 })),
    outerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    scaleFactor: vi.fn(async () => 1),
    onResized: api.onResized,
    onMoved: api.onMoved,
  }),
  currentMonitor: vi.fn(async () => ({
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
  })),
  LogicalSize: class LogicalSize {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
  },
  LogicalPosition: class LogicalPosition {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
  },
}));

import { rememberGeometry, restoreMainWindow } from "./windowState";

beforeEach(() => {
  localStorage.clear();
  api.maximize.mockClear();
  api.onResized.mockClear();
  api.onMoved.mockClear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});

describe("geometría de la ventana", () => {
  it("maximizar conserva el tamaño restaurado", () => {
    expect(
      rememberGeometry(
        { maximized: true, width: 1920, height: 1080, x: 0, y: 0 },
        { width: 1280, height: 720, x: 40, y: 20, maximized: false },
      ),
    ).toEqual({ width: 1280, height: 720, x: 40, y: 20, maximized: true });
  });

  it("registra onResized y onMoved aunque arranque maximizada", async () => {
    localStorage.setItem(
      "bara.window.main.v1",
      JSON.stringify({ width: 1280, height: 720, maximized: true }),
    );
    await restoreMainWindow();
    expect(api.maximize).toHaveBeenCalledOnce();
    expect(api.onResized).toHaveBeenCalledOnce();
    expect(api.onMoved).toHaveBeenCalledOnce();
  });
});

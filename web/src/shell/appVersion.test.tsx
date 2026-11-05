import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import packageJson from "../../../package.json";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.5.0"),
}));

import { getVersion } from "@tauri-apps/api/app";

import AppVersion from "./AppVersion";
import { readAppVersion } from "./readAppVersion";

afterEach(() => {
  cleanup();
  vi.mocked(getVersion).mockReset();
  vi.mocked(getVersion).mockResolvedValue("0.5.0");
});

describe("versión de la app", () => {
  it("muestra la versión que devuelve getVersion", async () => {
    vi.mocked(getVersion).mockResolvedValue("9.1.2");
    await expect(readAppVersion()).resolves.toBe("v9.1.2");
    vi.mocked(getVersion).mockResolvedValue("0.5.0");
    render(<AppVersion />);
    expect(await screen.findByText("v0.5.0")).toBeTruthy();
    expect(getVersion).toHaveBeenCalled();
  });

  it("si no hay runtime de Tauri, usa package.json", async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error("sin runtime"));
    await expect(readAppVersion()).resolves.toBe(`v${packageJson.version}`);
  });
});

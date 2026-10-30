import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AssistantText from "./components/AssistantText";

vi.mock("./clipboard", () => ({
  writeClipboard: vi.fn(async () => true),
}));

vi.mock("./baraVerify", () => ({
  verifyBaraBlock: vi.fn(async () => "verified"),
}));

import { writeClipboard } from "./clipboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("botón Copiar", () => {
  it("copia el bloque de código al portapapeles", async () => {
    render(
      <AssistantText text={"explicación\n```bara\nברא\n```\n"} />,
    );
    const buttons = await screen.findAllByRole("button", { name: "Copiar" });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]!);
    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalled();
    });
    expect(vi.mocked(writeClipboard).mock.calls.some((call) => String(call[0]).includes("ברא"))).toBe(
      true,
    );
  });
});

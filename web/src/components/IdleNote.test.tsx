import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import IdleNote from "./IdleNote";

afterEach(() => {
  cleanup();
});

describe("IdleNote", () => {
  it("muestra el mensaje y dispara transmutar / ahora no", () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    render(<IdleNote message="propuesta idle" onApply={onApply} onDismiss={onDismiss} />);
    expect(screen.getByText("propuesta idle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "transmutar" }));
    fireEvent.click(screen.getByRole("button", { name: "ahora no" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

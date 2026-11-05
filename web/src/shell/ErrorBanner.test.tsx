import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorBanner from "./ErrorBanner";

afterEach(() => {
  cleanup();
});

describe("banner de error", () => {
  it("se cierra con × y con Esc", () => {
    const onClose = vi.fn();
    render(<ErrorBanner message="no se pudo guardar" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(onClose).toHaveBeenCalledOnce();
    onClose.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

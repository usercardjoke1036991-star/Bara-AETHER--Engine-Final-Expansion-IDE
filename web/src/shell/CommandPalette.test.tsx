import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CommandPalette from "./CommandPalette";

afterEach(() => {
  cleanup();
});

const commands = [{ id: "x", label: "Acción de prueba", run: vi.fn() }];

describe("CommandPalette", () => {
  it("cierra con el botón ×", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);
    fireEvent.click(screen.getByTitle(/Cerrar \(Esc\)/i));
    expect(onClose).toHaveBeenCalled();
  });

  it("cierra con Esc", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("cierra con clic fuera", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);
    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalled();
  });
});

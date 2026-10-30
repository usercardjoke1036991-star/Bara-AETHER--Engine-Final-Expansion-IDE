import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PortalMenu from "./PortalMenu";

afterEach(() => {
  cleanup();
});

describe("PortalMenu", () => {
  it("cierra con Esc y con clic fuera; muestra todas las opciones", () => {
    const onClose = vi.fn();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <PortalMenu
        open
        anchor={anchor}
        onClose={onClose}
        items={[
          { id: "a", label: "Primera", onSelect: vi.fn() },
          { id: "b", label: "Segunda", onSelect: vi.fn() },
          { id: "c", label: "Tercera", onSelect: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByRole("menuitem", { name: /Primera/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Segunda/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Tercera/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    onClose.mockClear();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
    anchor.remove();
  });
});

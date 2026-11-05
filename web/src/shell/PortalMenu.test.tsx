import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PortalMenu, { placePortalMenu } from "./PortalMenu";

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

  it("hacia arriba resta la altura y, si no cabe, hace scroll interno", () => {
    const up = placePortalMenu({
      anchorTop: 700,
      anchorBottom: 740,
      anchorLeft: 20,
      anchorWidth: 80,
      menuHeight: 200,
      viewportWidth: 1366,
      viewportHeight: 768,
    });
    expect(up.top).toBe(700 - 200 - 4);
    expect(up.scroll).toBe(false);
    const cramped = placePortalMenu({
      anchorTop: 40,
      anchorBottom: 80,
      anchorLeft: 20,
      anchorWidth: 80,
      menuHeight: 400,
      viewportWidth: 320,
      viewportHeight: 200,
    });
    expect(cramped.top).toBe(8);
    expect(cramped.scroll).toBe(true);
    expect(cramped.maxHeight).toBe(184);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BottomTab } from "./layoutState";
import BottomTabStrip, { partitionTabs } from "./BottomTabs";

const tabs: Array<[BottomTab, string]> = [
  ["resumen", "Resumen"],
  ["tokens", "Tokens"],
  ["problemas", "Problemas"],
  ["git", "Git"],
  ["mapa", "Mapa"],
  ["oraculo", "Oráculo"],
  ["catalogo", "Catálogo"],
  ["bilattice", "Bilattice"],
  ["telemetria", "Telemetría"],
  ["topologia", "Topología"],
  ["ledger", "Ledger"],
  ["lienzo", "Lienzo"],
  ["nucleo", "Núcleo"],
];

afterEach(() => {
  cleanup();
});

describe("pestañas del panel inferior", () => {
  it("parte las que no caben", () => {
    const parts = partitionTabs(tabs, 4);
    expect(parts.shown).toHaveLength(4);
    expect(parts.overflow.map(([, label]) => label)).toContain("Núcleo");
  });

  it("deja ▬ □ × fuera del scroll y abre »", () => {
    const onSelect = vi.fn();
    const view = render(
      <BottomTabStrip
        tabs={tabs}
        active="resumen"
        slots={3}
        onSelect={onSelect}
        controls={
          <button type="button" aria-label="Minimizar panel">
            ▬
          </button>
        }
      />,
    );
    const controls = view.container.querySelector(".bottom-controls");
    expect(controls?.closest(".bottom-tabs")).toBeNull();
    expect(screen.getByRole("button", { name: "Minimizar panel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Más pestañas" }));
    const item = screen.getByRole("menuitem", { name: "Núcleo" });
    expect(item.closest(".bottom-panel")).toBeNull();
    const menu = item.closest('[role="menu"]');
    expect(menu?.parentElement).toBe(document.body);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith("nucleo");
  });

  it("el menú » sale del panel con overflow y se cierra con Esc o un clic fuera", () => {
    const view = render(
      <div className="bottom-panel" style={{ overflow: "hidden", height: 40 }}>
        <BottomTabStrip
          tabs={tabs}
          active="resumen"
          slots={3}
          onSelect={vi.fn()}
          controls={
            <button type="button" aria-label="Cerrar panel">
              ×
            </button>
          }
        />
      </div>,
    );
    const opener = screen.getByRole("button", { name: "Más pestañas" });
    fireEvent.click(opener);
    const item = screen.getByRole("menuitem", { name: "Núcleo" });
    const panel = view.container.querySelector(".bottom-panel");
    expect(panel?.contains(item)).toBe(false);
    expect(document.body.contains(item)).toBe(true);
    const menu = item.closest('[role="menu"]');
    expect(menu?.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Git" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Núcleo" })).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    expect(screen.getByRole("menuitem", { name: "Bilattice" })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

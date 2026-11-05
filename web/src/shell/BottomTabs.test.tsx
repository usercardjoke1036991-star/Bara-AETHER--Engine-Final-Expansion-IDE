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
    fireEvent.click(screen.getByRole("menuitem", { name: "Núcleo" }));
    expect(onSelect).toHaveBeenCalledWith("nucleo");
  });
});

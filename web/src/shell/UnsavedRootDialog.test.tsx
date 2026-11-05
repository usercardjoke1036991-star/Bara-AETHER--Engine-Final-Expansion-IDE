import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import UnsavedRootDialog, { unsavedTabs } from "./UnsavedRootDialog";

afterEach(() => {
  cleanup();
});

describe("cambio de carpeta con pestañas sucias", () => {
  it("detecta sólo las pestañas distintas del disco", () => {
    const dirty = unsavedTabs([
      { path: "a.rs", name: "a.rs", source: "nuevo", saved: "viejo" },
      { path: "b.rs", name: "b.rs", source: "igual", saved: "igual" },
    ]);
    expect(dirty.map((tab) => tab.path)).toEqual(["a.rs"]);
  });

  it("Guardar, Descartar y Cancelar son tres decisiones distintas", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <UnsavedRootDialog
        names={["a.rs"]}
        busy={false}
        onSave={onSave}
        onDiscard={onDiscard}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Cambios sin guardar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();

    view.rerender(
      <UnsavedRootDialog
        names={["a.rs"]}
        busy={false}
        onSave={onSave}
        onDiscard={onDiscard}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

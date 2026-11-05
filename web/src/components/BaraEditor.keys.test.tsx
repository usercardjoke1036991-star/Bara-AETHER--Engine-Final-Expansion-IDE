import { cleanup, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { escStopsAtField } from "../shell/uxRules";

vi.mock("../completion", () => ({
  localCompletions: vi.fn(async () => [
    {
      text: "alpha",
      partial: "alp",
      detail: "fn",
      distance: 0,
      cohesionMilli: 0,
    },
  ]),
}));

import BaraEditor from "./BaraEditor";

afterEach(() => {
  cleanup();
});

function viewOf(container: HTMLElement): EditorView {
  const editor = container.querySelector(".cm-editor");
  if (!(editor instanceof HTMLElement)) {
    throw new Error("falta el editor");
  }
  const view = EditorView.findFromDOM(editor);
  if (view === null) {
    throw new Error("falta la vista");
  }
  return view;
}

function press(view: EditorView, key: string): void {
  view.focus();
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("Esc y Enter en el editor", () => {
  it("Esc quita la sugerencia y no cierra el panel inferior", async () => {
    let bottomOpen = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || escStopsAtField(event)) {
        return;
      }
      bottomOpen = false;
    };
    window.addEventListener("keydown", onKey);
    const { container } = render(
      <BaraEditor value="al" path="src/a.rs" revealLine={null} revealToken={0} onChange={() => undefined} />,
    );
    const view = viewOf(container);
    view.dispatch({ selection: { anchor: 2 } });
    await waitFor(() => {
      expect(container.querySelector(".cm-ghost")?.textContent).toBe("pha");
    });
    press(view, "Escape");
    expect(container.querySelector(".cm-ghost")).toBeNull();
    expect(view.state.doc.toString()).toBe("al");
    expect(bottomOpen).toBe(true);
    window.removeEventListener("keydown", onKey);
  });

  it("Enter inserta una línea y no acepta la sugerencia", async () => {
    const { container } = render(
      <BaraEditor value="al" path="src/a.rs" revealLine={null} revealToken={0} onChange={() => undefined} />,
    );
    const view = viewOf(container);
    view.dispatch({ selection: { anchor: 2 } });
    await waitFor(() => {
      expect(container.querySelector(".cm-ghost")).not.toBeNull();
    });
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe("al\n");
    expect(container.querySelector(".cm-ghost")).toBeNull();
  });
});

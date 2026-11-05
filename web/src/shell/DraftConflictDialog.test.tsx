import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { draftLineDiff, planDraftSave, saveDraft, takeDraft } from "../editorDrafts";
import { contentHashOf } from "../workspace";
import DraftConflictDialog from "./DraftConflictDialog";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("borrador recuperado", () => {
  it("se guarda si el disco sigue en la huella del borrador", () => {
    const root = "C:/proj/demo";
    const path = "src/main.rs";
    const saved = "fn main() {}\n";
    const dirty = "fn main() { println!(\"hi\"); }\n";
    saveDraft(root, path, dirty, contentHashOf(saved));
    const draft = takeDraft(root, path);
    expect(draft).not.toBeNull();
    expect(planDraftSave(draft?.savedHash ?? "", saved, draft?.source ?? "")).toEqual({
      kind: "write",
      expectedHash: contentHashOf(saved),
    });
  });

  it("si el disco cambió, el diálogo muestra el diff y pregunta", () => {
    const saved = "fn main() {}\n";
    const disk = "fn main() { return 1; }\n";
    const dirty = "fn main() { println!(\"hi\"); }\n";
    const plan = planDraftSave(contentHashOf(saved), disk, dirty);
    expect(plan.kind).toBe("conflict");
    if (plan.kind !== "conflict") {
      return;
    }
    const onOverwrite = vi.fn();
    const onCancel = vi.fn();
    render(
      <DraftConflictDialog
        path="src/main.rs"
        diff={draftLineDiff(plan.disk, plan.draft)}
        busy={false}
        onOverwrite={onOverwrite}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("dialog", { name: "El archivo cambió en disco" })).toBeTruthy();
    expect(screen.getByText(/- fn main\(\) \{ return 1; \}/)).toBeTruthy();
    expect(screen.getByText(/\+ fn main\(\) \{ println!\("hi"\); \}/)).toBeTruthy();
    screen.getByRole("button", { name: "Cancelar" }).click();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onOverwrite).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDraft,
  listDraftsForProject,
  loadAutosaveEnabled,
  saveAutosaveEnabled,
  saveDraft,
  takeDraft,
} from "./editorDrafts";
import { contentHashOf } from "./workspace";

describe("editorDrafts + autosave", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("preferencia autosave on/off", () => {
    expect(loadAutosaveEnabled()).toBe(false);
    saveAutosaveEnabled(true);
    expect(loadAutosaveEnabled()).toBe(true);
    saveAutosaveEnabled(false);
    expect(loadAutosaveEnabled()).toBe(false);
  });

  it("recupera borrador tras crash simulado (flag de draft)", () => {
    const root = "C:/proj/demo";
    const path = "src/main.rs";
    const saved = "fn main() {}\n";
    const dirty = "fn main() { println!(\"hi\"); }\n";
    saveDraft(root, path, dirty, contentHashOf(saved));
    expect(listDraftsForProject(root)).toHaveLength(1);
    const recovered = takeDraft(root, path);
    expect(recovered?.source).toBe(dirty);
    expect(listDraftsForProject(root)).toHaveLength(0);
    saveDraft(root, path, dirty, contentHashOf(saved));
    clearDraft(root, path);
    expect(takeDraft(root, path)).toBeNull();
  });
});

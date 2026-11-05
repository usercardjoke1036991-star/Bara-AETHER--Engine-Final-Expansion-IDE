import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pending: Array<(unlisten: () => void) => void> = [];

vi.mock("../editorBridge", () => ({
  getEditorContext: () => new Promise(() => undefined),
  onEditorContext: () =>
    new Promise<() => void>((resolve) => {
      pending.push(resolve);
    }),
  proposeAiDeskAttachment: vi.fn(),
  readProjectFile: vi.fn(),
}));

vi.mock("./CockpitPanel", () => ({
  default: () => <div>cockpit</div>,
}));

vi.mock("./TopologyGraph", () => ({
  default: () => null,
}));

vi.mock("./FileTree", () => ({
  default: () => null,
}));

vi.mock("../aether", () => ({
  kernelAutopoiesis: vi.fn(),
  metalIr: vi.fn(),
}));

vi.mock("../engine", () => ({
  analyzeSource: vi.fn(() => new Promise(() => undefined)),
  describeError: (reason: unknown) => String(reason),
  kernelCatalogue: vi.fn(() => new Promise(() => undefined)),
  sampleGenesis: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock("../media", () => ({
  inspectMediaDialog: vi.fn(),
}));

vi.mock("../patchFlow", () => ({
  formatPatchDebug: () => "",
}));

vi.mock("../paths", () => ({
  dedupeTreeByPathKey: (entries: unknown) => entries,
}));

vi.mock("../workspace", () => ({
  workspaceActivate: vi.fn(),
  workspaceCloseRoot: vi.fn(),
  workspaceOpenDialog: vi.fn(),
  workspaceReadDocument: vi.fn(),
  workspaceRoots: vi.fn(() => new Promise(() => undefined)),
  workspaceTree: vi.fn(() => new Promise(() => undefined)),
}));

import DeskHost from "./DeskWindows";

afterEach(() => {
  cleanup();
  pending.length = 0;
});

describe("DeskWindows suelta el listener si se cierra antes", () => {
  it("desmontar el cockpit antes de que llegue el listener lo suelta", async () => {
    const view = render(<DeskHost vista="telemetry" />);
    expect(pending).toHaveLength(1);
    view.unmount();
    const unlisten = vi.fn();
    const resolve = pending[0];
    if (!resolve) {
      throw new Error("falta la suscripción");
    }
    resolve(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

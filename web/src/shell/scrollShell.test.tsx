import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../workspace", () => ({
  workspaceRoots: vi.fn(async () => ({ activeId: "", roots: [] })),
  workspaceActivate: vi.fn(),
  workspaceCloseRoot: vi.fn(),
  workspaceReopen: vi.fn(),
}));

vi.mock("../engine", () => ({
  describeError: (reason: unknown) => String(reason),
}));

import WorkspaceSidebar from "../components/WorkspaceSidebar";

afterEach(() => {
  cleanup();
});

function scrolls(style: CSSStyleDeclaration): boolean {
  return [style.overflow, style.overflowX, style.overflowY].some(
    (value) => value === "auto" || value === "scroll",
  );
}

describe("un scroll por zona", () => {
  it("el explorador y el panel inferior no anidan dos scrolls", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../styles.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = [...source.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .filter((match) => /overflow/.test(match[2] ?? ""))
      .map((match) => `${match[1]}{${match[2]}}`)
      .join("\n");
    document.head.appendChild(style);
    const view = render(
      <div className="ide-shell">
        <div className="ide-side">
          <WorkspaceSidebar
            root="C:/proj"
            tree={{ root: "C:/proj", name: "proj", entries: [], files: 0, truncated: false }}
            loading={false}
            activePath={null}
            onPickFolder={() => undefined}
            onClone={() => undefined}
            onRefresh={() => undefined}
            onOpenFile={() => undefined}
          />
        </div>
        <div className="bottom-body">
          <div className="zone-scroll">
            <div className="git-panel">git</div>
          </div>
          <div className="zone-scroll problems-panel">
            <ul className="problems-list">
              <li>uno</li>
            </ul>
          </div>
        </div>
      </div>,
    );
    const scrollers = [...view.container.querySelectorAll("*")].filter((node) =>
      scrolls(getComputedStyle(node)),
    );
    for (const node of scrollers) {
      let parent = node.parentElement;
      while (parent) {
        expect(scrolls(getComputedStyle(parent))).toBe(false);
        parent = parent.parentElement;
      }
    }
    const tree = view.container.querySelector(".workspace-tree");
    const workspace = view.container.querySelector(".ide-side .workspace");
    expect(tree).toBeTruthy();
    expect(workspace).toBeTruthy();
    expect(scrolls(getComputedStyle(tree as Element))).toBe(true);
    expect(scrolls(getComputedStyle(workspace as Element))).toBe(false);
    expect(view.container.querySelector(".ws-projects details")).toBeTruthy();
    style.remove();
  });
});

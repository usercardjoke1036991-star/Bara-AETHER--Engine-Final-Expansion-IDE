import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyReport, type AutoApplyReport } from "../autoApply";

const listenHandler: { current: ((event: { payload: { patch?: string } }) => void) | null } = {
  current: null,
};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: { patch?: string } }) => void) => {
    listenHandler.current = handler;
    return () => {
      listenHandler.current = null;
    };
  }),
}));

vi.mock("../ai/keyring", () => ({
  deleteKey: vi.fn(async () => undefined),
  inDesktop: () => true,
  keyExists: vi.fn(async () => false),
  probeConnection: vi.fn(async () => ({ ok: true, detail: "ok" })),
  saveKey: vi.fn(async () => undefined),
}));

vi.mock("../ai/providers", () => ({
  listModels: vi.fn(async () => []),
  sendChat: vi.fn(async () => ({ text: "", model: "", usage: null })),
}));

vi.mock("../offline", () => ({
  loadLocalWeights: vi.fn(async () => ({
    name: "",
    architecture: "",
    context: 0,
    tensors: 0,
    parameters: 0,
  })),
  localComplete: vi.fn(async () => ({
    name: "",
    architecture: "",
    glyph: "∅",
    reply: "",
  })),
}));

vi.mock("../engine", () => ({
  shoreshTranslate: vi.fn(async () => ({ text: "", synthesized: 0 })),
}));

vi.mock("../windows", () => ({
  currentVista: vi.fn(async () => "main"),
  openDeskWindow: vi.fn(async () => undefined),
}));

vi.mock("../clipboard", () => ({
  writeClipboard: vi.fn(async () => true),
}));

vi.mock("../baraVerify", () => ({
  verifyBaraBlock: vi.fn(async () => "unverified"),
  statusFromAnalysis: vi.fn(() => "unverified"),
}));

import ChatPanel from "./ChatPanel";

function reviewReport(): AutoApplyReport {
  return {
    ...emptyReport(1),
    glyph: "∅",
    status: "neither",
    verified: false,
    canApply: false,
    path: "doc.bara",
    previewDiff: "--- a/doc.bara\n+++ b/doc.bara\n+ברא\n",
    blockReason: "∅: Auto-Apply bloqueado; puedes Aceptar a mano",
    judgmentId: "j-test",
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listenHandler.current = null;
});

beforeEach(() => {
  listenHandler.current = null;
});

describe("ChatPanel Aceptar / Rechazar / Deshacer", () => {
  it("Aceptar confirma, Rechazar limpia el diff, Deshacer restaura", async () => {
    const onJudge = vi.fn(async () => reviewReport());
    const onConfirm = vi.fn(async () => ({
      ...reviewReport(),
      applied: true,
      backupPath: ".bara-backup/stamp/doc.bara.bak",
      path: "doc.bara",
    }));
    const onUndo = vi.fn(async () => ({
      ...reviewReport(),
      applied: true,
      path: "doc.bara",
    }));

    render(
      <ChatPanel
        open
        documentName="doc.bara"
        documentSource="ברא\n"
        analysis={null}
        catalogue={[]}
        sample=""
        acceptRemotePatches
        onJudge={onJudge}
        onConfirm={onConfirm}
        onUndo={onUndo}
      />,
    );

    await waitFor(() => {
      expect(listenHandler.current).not.toBeNull();
    });

    listenHandler.current?.({ payload: { patch: "ברא\n" } });

    const accept = await screen.findByRole("button", { name: /^Aceptar$/i });
    fireEvent.click(accept);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });

    // Tras aceptar con backup, debe aparecer Deshacer.
    const undo = await screen.findByRole("button", { name: /Deshacer/i });
    fireEvent.click(undo);
    await waitFor(() => {
      expect(onUndo).toHaveBeenCalled();
    });

    // Nuevo review → Rechazar.
    listenHandler.current?.({ payload: { patch: "ברא\n" } });
    const reject = await screen.findByRole("button", { name: /Rechazar/i });
    fireEvent.click(reject);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Aceptar$/i })).toBeNull();
    });
    expect(onJudge).toHaveBeenCalled();
  });
});

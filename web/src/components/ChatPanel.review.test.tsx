import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyReport, type AutoApplyReport } from "../autoApply";
import { DEFAULT_CONFIG, LOCAL_ACCEPTED_KEY, STORAGE_KEY } from "../ai/config";
import { sendChat } from "../ai/providers";

const listenHandler: { current: ((event: { payload: { patch?: string } }) => void) | null } = {
  current: null,
};

const deskListen: {
  current: ((event: { payload: { name?: string; source?: string } }) => void) | null;
} = { current: null };

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      name: string,
      handler: (event: { payload: { patch?: string; name?: string; source?: string } }) => void,
    ) => {
      if (name === "ai-desk-attachment") {
        deskListen.current = handler;
        return () => {
          deskListen.current = null;
        };
      }
      listenHandler.current = handler;
      return () => {
        listenHandler.current = null;
      };
    },
  ),
}));

vi.mock("../ai/keyring", () => ({
  deleteKey: vi.fn(async () => undefined),
  inDesktop: () => true,
  keyExists: vi.fn(async () => false),
  saveKey: vi.fn(async () => undefined),
  probeConnection: vi.fn(async () => ({
    ok: true,
    steps: [{ ok: true, name: "http", detail: "ok" }],
    models: ["otro-modelo"],
  })),
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
  cancelAiInFlight: vi.fn(async () => undefined),
  interruptKernel: vi.fn(async () => undefined),
  armAiTurn: vi.fn(async () => undefined),
}));

vi.mock("../windows", () => ({
  currentVista: vi.fn(async () => "main"),
  openDeskWindow: vi.fn(async () => undefined),
}));

vi.mock("../clipboard", () => ({
  writeClipboard: vi.fn(async () => true),
}));

vi.mock("../liveMap", async () => {
  const actual = await vi.importActual<typeof import("../liveMap")>("../liveMap");
  return {
    ...actual,
    liveMapImpact: vi.fn(async () => ({
      focus: ["doc.bara"],
      filesAffected: 1,
      testsAffected: 0,
      related: ["doc.bara"],
      summary: "afecta a 1 archivo(s) y 0 test(s)",
    })),
    liveMapGate: vi.fn(async () => ({
      ok: true,
      impact: {
        focus: ["doc.bara"],
        filesAffected: 1,
        testsAffected: 0,
        related: ["doc.bara"],
        summary: "ok",
      },
      broken: [],
      blockReason: "",
    })),
    liveMapApplyBatch: vi.fn(async () => ({
      applied: true,
      paths: [],
      backups: [],
      rolledBack: false,
      detail: "aplicados",
    })),
  };
});

vi.mock("../baraVerify", () => ({
  verifyBaraBlock: vi.fn(async () => "unverified"),
  statusFromAnalysis: vi.fn(() => "unverified"),
}));

vi.mock("../editorBridge", () => ({
  PROPOSE_PATCH_EVENT: "assistant-propose-patch",
  proposeEditorPatch: vi.fn(async () => undefined),
  readProjectFile: vi.fn(async (path: string) => {
    if (String(path).includes("big.rs")) {
      throw new Error("«big.rs» supera 256 KiB y el asistente no lo lee");
    }
    throw new Error(`no existe: «${String(path)}»`);
  }),
}));

import ChatPanel from "./ChatPanel";
import { cancelAiInFlight } from "../engine";
import { liveMapApplyBatch, liveMapGate } from "../liveMap";
import { localComplete } from "../offline";

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
  deskListen.current = null;
});

beforeEach(() => {
  listenHandler.current = null;
  deskListen.current = null;
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
    expect(screen.getByText("Este cambio NO está verificado")).toBeTruthy();
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

  it("el aviso rojo es status, deja el alert al mapa y no llama al modelo", async () => {
    vi.mocked(liveMapGate).mockResolvedValueOnce({
      ok: false,
      impact: {
        focus: ["doc.bara"],
        filesAffected: 1,
        testsAffected: 0,
        related: ["doc.bara"],
        summary: "afecta a 1 archivo(s)",
      },
      broken: [{ path: "doc.bara", target: "lib", detail: "roto" }],
      blockReason: "el cambio rompería imports",
    });
    const onJudge = vi.fn(async () => reviewReport());
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
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(listenHandler.current).not.toBeNull();
    });
    listenHandler.current?.({ payload: { patch: "ברא\n" } });

    const warn = await screen.findByText("Este cambio NO está verificado");
    expect(warn.getAttribute("role")).toBe("status");
    expect(screen.getByRole("button", { name: "Aceptar" })).toBeTruthy();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent ?? "").toMatch(/rompería imports/);
    expect(alerts[0]?.contains(warn)).toBe(false);
    expect(onJudge).toHaveBeenCalled();
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("si el mapa cae al revalidar, Aceptar no confirma", async () => {
    const onJudge = vi.fn(async () => reviewReport());
    const onConfirm = vi.fn();
    const gate = vi.mocked(liveMapGate);
    gate.mockResolvedValueOnce({
      ok: true,
      blockReason: "",
      broken: [],
      impact: {
        focus: ["doc.bara"],
        filesAffected: 1,
        testsAffected: 0,
        related: ["doc.bara"],
        summary: "ok",
      },
    });
    gate.mockRejectedValueOnce(new Error("mapa caído"));

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
        onUndo={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listenHandler.current).not.toBeNull();
    });
    listenHandler.current?.({ payload: { patch: "ברא\n" } });
    const accept = await screen.findByRole("button", { name: /^Aceptar$/i });
    fireEvent.click(accept);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/no se escribe/i);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Auto-Apply no confirma si el mapa cae", async () => {
    localStorage.setItem("bara.autoApply.v2", "1");
    localStorage.setItem("bara.autoApply", "1");
    const onConfirm = vi.fn();
    vi.mocked(liveMapGate).mockRejectedValue(new Error("mapa caído"));
    const onJudge = vi.fn(async () => ({
      ...reviewReport(),
      verified: true,
      canApply: true,
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
        onUndo={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listenHandler.current).not.toBeNull();
    });
    listenHandler.current?.({ payload: { patch: "ברא\n" } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/no se escribe/i);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    localStorage.removeItem("bara.autoApply");
    localStorage.removeItem("bara.autoApply.v2");
  });

  it("diff parcial multiarchivo no aplica el recorte", async () => {
    const apply = vi.mocked(liveMapApplyBatch);
    const diff = [
      "diff --git a/src/a.rs b/src/a.rs",
      "--- a/src/a.rs",
      "+++ b/src/a.rs",
      "@@ -2,1 +2,1 @@",
      "-alpha",
      "+beta",
      "diff --git a/src/b.rs b/src/b.rs",
      "--- a/src/b.rs",
      "+++ b/src/b.rs",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    render(
      <ChatPanel
        open
        documentName="doc.bara"
        documentSource="ברא\n"
        analysis={null}
        catalogue={[]}
        sample=""
        acceptRemotePatches
        onJudge={vi.fn()}
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(listenHandler.current).not.toBeNull();
    });
    listenHandler.current?.({ payload: { patch: diff } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/no se escribe/i);
    });
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent ?? "").not.toBe("beta\n");
  });

  it("un archivo de 300 KiB rechaza el lote y no escribe", async () => {
    const apply = vi.mocked(liveMapApplyBatch);
    const diff = [
      "diff --git a/src/big.rs b/src/big.rs",
      "--- a/src/big.rs",
      "+++ b/src/big.rs",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "diff --git a/src/ok.rs b/src/ok.rs",
      "--- a/src/ok.rs",
      "+++ b/src/ok.rs",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    render(
      <ChatPanel
        open
        documentName="doc.bara"
        documentSource="ברא\n"
        analysis={null}
        catalogue={[]}
        sample=""
        acceptRemotePatches
        onJudge={vi.fn()}
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(listenHandler.current).not.toBeNull();
    });
    listenHandler.current?.({ payload: { patch: diff } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/big\.rs/);
    });
    expect(screen.getByRole("alert").textContent ?? "").toMatch(/no se escribe/i);
    expect(apply).not.toHaveBeenCalled();
  });

  it("si Detener falla el invoke, avisa que no se pudo detener", async () => {
    vi.mocked(cancelAiInFlight).mockRejectedValueOnce(new Error("ipc denegado"));
    vi.mocked(localComplete).mockImplementation(
      (_text: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          const fail = () => reject(new DOMException("abortado", "AbortError"));
          if (signal?.aborted) {
            fail();
            return;
          }
          signal?.addEventListener("abort", fail);
        }),
    );
    render(
      <ChatPanel
        open
        documentName="doc.bara"
        documentSource=""
        analysis={null}
        catalogue={[]}
        sample=""
        onJudge={vi.fn()}
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Offline" }));
    fireEvent.change(screen.getByPlaceholderText(/Pregunte/), { target: { value: "hola" } });
    const sendButton = screen.getByRole("button", { name: "Enviar" });
    const form = sendButton.closest("form");
    if (!form) {
      throw new Error("falta el formulario");
    }
    fireEvent.submit(form);
    const cancelButtons = await screen.findAllByRole("button", { name: "Cancelar" });
    const cancel = cancelButtons[0];
    if (!cancel) {
      throw new Error("falta Cancelar");
    }
    fireEvent.click(cancel);
    expect(await screen.findByText(/No se pudo detener/i)).toBeTruthy();
    expect(screen.queryByText("Consulta cancelada.")).toBeNull();
  });
});

describe("adjunto desde Asistencia", () => {
  it("el evento en main muestra el adjunto, el tamaño y se puede quitar", async () => {
    const onEnsureOpen = vi.fn();
    const view = render(
      <ChatPanel
        open={false}
        documentName="doc.bara"
        documentSource=""
        analysis={null}
        catalogue={[]}
        sample=""
        acceptRemotePatches
        onEnsureOpen={onEnsureOpen}
        onJudge={vi.fn()}
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(deskListen.current).not.toBeNull();
    });
    deskListen.current?.({ payload: { name: "nota.rs", source: "fn a() {}\n" } });
    expect(onEnsureOpen).toHaveBeenCalled();
    view.rerender(
      <ChatPanel
        open
        documentName="doc.bara"
        documentSource=""
        analysis={null}
        catalogue={[]}
        sample=""
        acceptRemotePatches
        onEnsureOpen={onEnsureOpen}
        onJudge={vi.fn()}
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(await screen.findByText("nota.rs")).toBeTruthy();
    expect(screen.getByText(/10 B/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar nota.rs" }));
    expect(screen.queryByText("nota.rs")).toBeNull();
  });
});

describe("usar en el editor", () => {
  it("abre el diff aunque la vista no sea main", async () => {
    const { saveChatHistory, clearChatHistory } = await import("../ai/chatHistory");
    const { proposeEditorPatch } = await import("../editorBridge");
    const { currentVista } = await import("../windows");
    vi.mocked(currentVista).mockResolvedValue("ai-workspace");
    saveChatHistory("proj-n12", [
      {
        id: "1",
        role: "assistant",
        text: "```rust\nfn a() {}\n```",
        images: [],
        model: "test",
        createdAt: 1,
        error: null,
      },
    ]);
    const onJudge = vi.fn(async () => reviewReport());
    render(
      <ChatPanel
        open
        projectId="proj-n12"
        documentName="doc.bara"
        documentSource="fn a() {}\n"
        analysis={null}
        catalogue={[]}
        sample=""
        onJudge={onJudge}
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "usar en el editor" }));
    await waitFor(() => {
      expect(onJudge).toHaveBeenCalled();
    });
    expect(proposeEditorPatch).not.toHaveBeenCalled();
    clearChatHistory("proj-n12");
  });
});

describe("modelos vivos en el envío", () => {
  it("Enter no envía un modelo que la sonda acaba de descartar", async () => {
    localStorage.setItem(LOCAL_ACCEPTED_KEY, "1");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        provider: "local",
        model: "llama3.2",
        baseUrl: "http://127.0.0.1:11434",
        apiKey: "",
        hasKey: false,
      }),
    );
    render(
      <ChatPanel
        open
        documentName="doc.bara"
        documentSource=""
        analysis={null}
        catalogue={[]}
        sample=""
        onJudge={vi.fn()}
        onConfirm={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Pregunte sobre Shoresh/i), {
      target: { value: "hola" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ajustes" }));
    fireEvent.click(screen.getByRole("button", { name: "Probar conexión" }));
    await screen.findByText(/sonda OK/i);
    fireEvent.click(screen.getByRole("button", { name: "chat" }));
    const send = screen.getByRole("button", { name: "Enviar" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(send.getAttribute("title")).toMatch(/lista viva/);
    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText(/Pregunte sobre Shoresh/i), {
        key: "Enter",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(sendChat).not.toHaveBeenCalled();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LOCAL_ACCEPTED_KEY);
  });
});

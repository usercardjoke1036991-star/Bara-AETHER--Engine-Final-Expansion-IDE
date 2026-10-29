import { listen } from "@tauri-apps/api/event";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  CLASS_LABEL,
  analyzeSource,
  belnapLattice,
  describeError,
  kernelCatalogue,
  kernelHostStatus,
  oracleConverse,
  oracleReset,
  oracleStatus,
  sampleGenesis,
  temporalRollback,
  type Analysis,
  type BelnapLattice,
  type RootEntry,
  type SessionStatus,
  type TokenInfo,
  type TurnView,
} from "./engine";
import {
  githubClone,
  workspaceOpenDialog,
  workspaceReadDocument,
  workspaceReadSource,
  workspaceTree,
  workspaceWriteDocument,
  type WorkspaceEntry,
  type WorkspaceTree,
} from "./workspace";
import { analysisStillCurrent } from "./analysisGate";
import { judgeAutoPatch } from "./autoApply";
import { idleApply, idleDismiss, idleProposal, type IdleNotice } from "./idle";
import { runWorkspaceRecipe, type RecipeName } from "./recipes";
import { publishVeto } from "./topology";
import BaraEditor from "./components/BaraEditor";
import ChatPanel from "./components/ChatPanel";
import CockpitPanel from "./components/CockpitPanel";
import KernelConsole, { type ConsoleLine } from "./components/KernelConsole";
import KernelPanel from "./components/KernelPanel";
import VisualBuilder from "./components/VisualBuilder";
import DeskHost from "./components/DeskWindows";
import WelcomeGate from "./components/WelcomeGate";
import WorkspaceSidebar from "./components/WorkspaceSidebar";
import { readReveal, TOPOLOGY_CHANNEL } from "./topology";
import { currentVista, openDeskWindow, type DeskVista } from "./windows";

/** Máximo de filas de tokens que se pintan (rendimiento del WebView). */
const MAX_ROWS = 1200;

/** Documento abierto en el editor. */
interface EditorTab {
  /** Ruta relativa al workspace (contrato de `workspace.rs`). */
  path: string;
  /** Nombre visible en la pestaña. */
  name: string;
  /** Texto vivo del editor. */
  source: string;
  /** Último texto confirmado en disco. */
  saved: string;
}

/**
 * Un fallo al pintar el núcleo o el lienzo se queda en ese panel.
 * Sin esto, React desmonta el editor entero y la ventana queda en blanco.
 */
class PanelGuard extends Component<
  { name: string; resetKey: boolean; children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidUpdate(previous: { resetKey: boolean }): void {
    if (previous.resetKey !== this.props.resetKey && this.state.message !== null) {
      this.setState({ message: null });
    }
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <p className="error">
          El panel {this.props.name} se detuvo: {this.state.message}. El editor sigue activo.
        </p>
      );
    }
    return this.props.children;
  }
}

function kernelTone(label: string): "ok" | "wait" | "down" {
  if (label === "activo") return "ok";
  if (label === "caído") return "down";
  return "wait";
}

export default function App() {
  /** Documentos abiertos; el activo se proyecta a `source`/`origin`. */
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [catalogue, setCatalogue] = useState<RootEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kernelPill, setKernelPill] = useState("…");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  /** Raíz canónica del explorador y su última enumeración. */
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceTree | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  /** Puerta de apertura: carpeta local o clon de GitHub. */
  const [showWelcome, setShowWelcome] = useState(true);
  const [importing, setImporting] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<string | null>(null);
  /** Documento de ejemplo del kernel (contexto del asistente). */
  const [sample, setSample] = useState("");
  /** Visibilidad del panel lateral del asistente. */
  const [aiOpen, setAiOpen] = useState(false);
  /** Visibilidad del panel de proyecciones del kernel AETHER-Ω. */
  const [kernelOpen, setKernelOpen] = useState(false);
  /** Visibilidad del panel del constructor visual (lienzo → Shoresh firmado). */
  const [visualOpen, setVisualOpen] = useState(false);
  /** Visibilidad del Cockpit de telemetría (censo, transmutador, Shoresh, caja negra). */
  const [cockpitOpen, setCockpitOpen] = useState(false);
  const [idle, setIdle] = useState<IdleNotice | null>(null);
  /** Sesión del oráculo: estado que mide el kernel y último turno conversado. */
  const [oracle, setOracle] = useState<SessionStatus | null>(null);
  const [lastTurn, setLastTurn] = useState<TurnView | null>(null);
  /** Marcador temporal capturado para el `Δ⁻¹` manual. */
  const [marker, setMarker] = useState<number | null>(null);
  /** Biláttice de Belnap que sirve el kernel. */
  const [lattice, setLattice] = useState<BelnapLattice | null>(null);
  /** Consulta que se conversa con el oráculo (léxico del kernel). */
  const [query, setQuery] = useState("ברא");
  /** Transcripción de la consola inferior (mismo oráculo, sin PTY). */
  const [consoleLog, setConsoleLog] = useState<ConsoleLine[]>([]);
  /** Etiqueta de esta ventana. `null` hasta leerla. */
  const [vista, setVista] = useState<DeskVista | null>(null);
  /** Salto pedido por el grafo topológico. */
  const [reveal, setReveal] = useState<{ path: string; line: number; token: number } | null>(null);
  const revealToken = useRef(0);
  const tabsRef = useRef(tabs);

  useEffect(() => {
    void currentVista().then(setVista);
  }, []);

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const current = await kernelHostStatus();
        if (alive) setKernelPill(current);
        const unlisten = await listen<string>("kernel-host", (event) => {
          if (alive) setKernelPill(event.payload);
        });
        if (alive) stop = unlisten;
        else unlisten();
      } catch {
        if (alive) setKernelPill("caído");
      }
    })();
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [tabs, activePath],
  );
  const source = activeTab?.source ?? "";
  const origin = activeTab?.path ?? "<editor>";
  const sourceRef = useRef(source);
  const pathRef = useRef(activePath);
  const cursorLineRef = useRef(1);
  const analysisGen = useRef(0);
  sourceRef.current = source;
  pathRef.current = activePath;
  const dirty = activeTab !== null && activeTab.source !== activeTab.saved;

  /** Invoca al backend del kernel y publica el resultado si sigue vigente. */
  const runAnalysis = useCallback(async (text: string, path: string | null) => {
    const generation = analysisGen.current + 1;
    analysisGen.current = generation;
    const request = { generation, text, path };
    setBusy(true);
    try {
      const result = await analyzeSource(text);
      if (!analysisStillCurrent(request, analysisGen.current, sourceRef.current, pathRef.current)) {
        return;
      }
      setAnalysis(result);
      setError(null);
    } catch (failure) {
      if (generation !== analysisGen.current) {
        return;
      }
      setError(describeError(failure));
    } finally {
      if (generation === analysisGen.current) {
        setBusy(false);
      }
    }
  }, []);

  // Arranque: catálogo del kernel y documento de ejemplo, ambos servidos por
  // Rust (en TypeScript no se duplica ni un literal del núcleo).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [roots, genesis, belnap, session] = await Promise.all([
          kernelCatalogue(),
          sampleGenesis(),
          belnapLattice(),
          oracleStatus(),
        ]);
        if (!alive) {
          return;
        }
        setCatalogue(roots);
        setSample(genesis);
        setLattice(belnap);
        setOracle(session);
        setTabs([
          {
            path: "samples/genesis.bara",
            name: "genesis.bara",
            source: genesis,
            saved: genesis,
          },
        ]);
        setActivePath("samples/genesis.bara");
        setReady(true);
      } catch (failure) {
        if (alive) {
          setError(describeError(failure));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Vuelve a enumerar la raíz que el backend ya tiene activa. */
  const refreshWorkspace = useCallback(async () => {
    setWorkspaceLoading(true);
    try {
      const next = await workspaceTree();
      setWorkspace(next);
      setWorkspaceRoot(next.root);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setWorkspaceLoading(false);
    }
  }, []);

  // El explorador arranca en paralelo con el catálogo y el documento de
  // ejemplo: un fallo del árbol no impide analizar el texto del editor.
  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const adoptWorkspace = useCallback((next: WorkspaceTree) => {
    setWorkspace(next);
    setWorkspaceRoot(next.root);
    setError(null);
    setShowWelcome(false);
    setCloneProgress(null);
  }, []);

  /** El diálogo del sistema elige la carpeta; el WebView no manda la ruta. */
  const pickFolder = useCallback(async () => {
    setWorkspaceLoading(true);
    setError(null);
    try {
      adoptWorkspace(await workspaceOpenDialog());
    } catch (failure) {
      const message = describeError(failure);
      if (message !== "cancelado") {
        setError(message);
      }
    } finally {
      setWorkspaceLoading(false);
    }
  }, [adoptWorkspace]);

  /** URL allowlist en Rust, carpeta por diálogo, `git clone` sin shell. */
  const cloneRepository = useCallback(
    async (url: string) => {
      setImporting(true);
      setCloneProgress("comprobando la URL…");
      setError(null);
      let unlisten: (() => void) | null = null;
      try {
        unlisten = await listen<string>("github-clone-progress", (event) => {
          setCloneProgress(event.payload);
        });
      } catch {
        unlisten = null;
      }
      try {
        adoptWorkspace(await githubClone(url));
      } catch (failure) {
        const message = describeError(failure);
        if (message !== "cancelado") {
          setError(message);
        }
        setCloneProgress(null);
      } finally {
        if (unlisten) {
          unlisten();
        }
        setImporting(false);
      }
    },
    [adoptWorkspace],
  );

  // Análisis en vivo con retardo: no se invoca al kernel en cada tecla.
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const text = source;
    const path = activePath;
    const timer = window.setTimeout(() => {
      void runAnalysis(text, path);
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready, source, activePath, runAnalysis]);

  /** Abre un `.bara` del árbol; si ya está en una pestaña, sólo la activa. */
  const openWorkspaceFile = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!entry.bara) {
        return;
      }
      if (tabs.some((tab) => tab.path === entry.path)) {
        setActivePath(entry.path);
        return;
      }
      if (workspaceRoot.length === 0) {
        setError("El workspace aún no tiene una raíz válida.");
        return;
      }

      setBusy(true);
      try {
        const document = await workspaceReadDocument(entry.path);
        setTabs((current) =>
          current.some((tab) => tab.path === document.path)
            ? current
            : [
                ...current,
                {
                  path: document.path,
                  name: document.name,
                  source: document.source,
                  saved: document.source,
                },
              ],
        );
        setActivePath(document.path);
        setError(null);
      } catch (failure) {
        setError(describeError(failure));
      } finally {
        setBusy(false);
      }
    },
    [tabs, workspaceRoot],
  );

  tabsRef.current = tabs;

  /** Abre la fuente que el grafo señaló y coloca el cursor en su línea. */
  const openFromGraph = useCallback(async (path: string, line: number) => {
    const normalized = path.replaceAll("\\", "/");
    if (!tabsRef.current.some((tab) => tab.path === normalized)) {
      const document = await workspaceReadSource(normalized);
      setTabs((current) =>
        current.some((tab) => tab.path === document.path)
          ? current
          : [
              ...current,
              {
                path: document.path,
                name: document.name,
                source: document.source,
                saved: document.source,
              },
            ],
      );
    }
    revealToken.current += 1;
    setActivePath(normalized);
    setReveal({ path: normalized, line, token: revealToken.current });
    setError(null);
  }, []);

  useEffect(() => {
    if (vista !== "main") {
      return undefined;
    }
    const channel = new BroadcastChannel(TOPOLOGY_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const request = readReveal(event.data);
      if (request === null) {
        return;
      }
      void openFromGraph(request.path, request.line).catch((reason: unknown) => {
        setError(describeError(reason));
      });
    };
    return () => channel.close();
  }, [vista, openFromGraph]);

  useEffect(() => {
    if (vista !== "main") {
      return undefined;
    }
    let alive = true;
    const tick = () => {
      void idleProposal()
        .then((notice) => {
          if (alive) {
            setIdle(notice);
          }
        })
        .catch(() => {
          if (alive) {
            setIdle(null);
          }
        });
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [vista]);

  /** Cierra una pestaña; pide confirmación si hay cambios sin guardar. */
  const closeTab = useCallback(
    (path: string) => {
      const tab = tabs.find((candidate) => candidate.path === path);
      if (!tab) {
        return;
      }
      if (
        tab.source !== tab.saved &&
        !window.confirm(`«${tab.name}» tiene cambios sin guardar. ¿Cerrar igualmente?`)
      ) {
        return;
      }

      setTabs((current) => current.filter((candidate) => candidate.path !== path));
      if (activePath === path) {
        const index = tabs.findIndex((candidate) => candidate.path === path);
        const next = tabs[index + 1] ?? tabs[index - 1] ?? null;
        setActivePath(next?.path ?? null);
      }
    },
    [activePath, tabs],
  );

  /** Guarda el documento activo con `workspace_write_document`. */
  const saveActive = useCallback(async () => {
    if (!activeTab || activeTab.source === activeTab.saved) {
      return;
    }
    if (workspaceRoot.length === 0) {
      setError("No hay una raíz de workspace para guardar el documento.");
      return;
    }

    setSaving(true);
    try {
      const document = await workspaceWriteDocument(activeTab.path, activeTab.source);
      // Se actualiza sólo la marca de guardado: si el usuario escribió
      // mientras se persistía, su texto vivo no se pisa.
      setTabs((current) =>
        current.map((tab) =>
          tab.path === document.path ? { ...tab, saved: document.source } : tab,
        ),
      );
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSaving(false);
    }
  }, [activeTab, workspaceRoot]);

  // Ctrl/Cmd+S guarda el documento activo sin sacar el foco del editor.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActive();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActive]);

  /** Receta del catálogo cerrado. No abre un shell. */
  const runRecipe = useCallback(async (recipe: RecipeName) => {
    setBusy(true);
    try {
      const report = await runWorkspaceRecipe(recipe);
      const faults = report.lines.filter((line) => line.status === "false").slice(0, 6);
      const reply = [
        `${report.recipe} · salida ${report.exitCode} · ⊤ ${report.trueCount} · ⊥ ${report.falseCount} · ⊤∧⊥ ${report.bothCount} · ∅ ${report.neitherCount}${report.truncated ? " · recortado" : ""}${report.timedOut ? " · tiempo agotado" : ""}`,
        ...faults.map((line) => `${line.glyph} ${line.text}`),
      ].join("\n");
      setConsoleLog((current) => [...current, { input: recipe, reply, roots: "" }].slice(-40));
    } catch (failure) {
      const reply = describeError(failure);
      setConsoleLog((current) => [...current, { input: recipe, reply, roots: "" }].slice(-40));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      // `event.code` (Digit1) sobrevive a teclados ES donde Alt+1 no produce key="1".
      const recipe: RecipeName | null =
        event.code === "Digit1" || event.key === "1"
          ? "check"
          : event.code === "Digit2" || event.key === "2"
            ? "test"
            : event.code === "Digit3" || event.key === "3"
              ? "typecheck"
              : null;
      if (recipe === null || vista !== "main") {
        return;
      }
      event.preventDefault();
      void runRecipe(recipe);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runRecipe, vista]);

  /** Conversa un turno con el oráculo del kernel (`oracle_converse`). */
  const converse = useCallback(async (line: string) => {
    const text = line.trim();
    if (text.length === 0) {
      return;
    }
    setBusy(true);
    try {
      const result = await oracleConverse(text);
      setLastTurn(result.turn);
      setOracle(result.status);
      if (result.turn) {
        const turn = result.turn;
        setConsoleLog((current) =>
          [
            ...current,
            { input: text, reply: turn.reply, roots: turn.roots },
          ].slice(-40),
        );
      }
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  const askOracle = useCallback(async () => {
    await converse(query);
  }, [converse, query]);

  /** Captura el marcador temporal actual para el `Δ⁻¹` manual. */
  const markTimeline = useCallback(() => {
    if (oracle) {
      setMarker(oracle.nextMarker);
    }
  }, [oracle]);

  /** Control temporal: rebobina `Δ⁻¹` hasta el marcador capturado. */
  const rollbackTimeline = useCallback(async () => {
    if (marker === null) {
      return;
    }
    setBusy(true);
    try {
      const result = await temporalRollback(marker);
      setOracle(result.status);
      setLastTurn(null);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [marker]);

  /** Cierra la sesión del oráculo y vuelve al estado virgen. */
  const closeOracle = useCallback(async () => {
    setBusy(true);
    try {
      setOracle(await oracleReset());
      setLastTurn(null);
      setMarker(null);
      setConsoleLog([]);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Lleva al editor un bloque de código propuesto por el asistente.
   *
   * Se **añade** al final del documento en vez de sustituirlo: el panel nunca
   * destruye lo que el usuario tenga escrito. El kernel vuelve a analizarlo en
   * cuanto cambia la fuente (efecto con retardo de 200 ms).
   */
  const updateActiveSource = useCallback(
    (next: string | ((previous: string) => string)) => {
      if (!activePath) {
        return;
      }
      setTabs((current) =>
        current.map((tab) =>
          tab.path === activePath
            ? {
                ...tab,
                source:
                  typeof next === "function" ? next(tab.source) : next,
              }
            : tab,
        ),
      );
    },
    [activePath],
  );

  const judgeSuggestion = useCallback(async (patch: string) => {
    const path = pathRef.current;
    if (path === null || path.length === 0) {
      return {
        glyph: "⊥",
        status: "false",
        applied: false,
        path: "",
        line: cursorLineRef.current,
        inserted: 0,
        source: "",
      };
    }
    const report = await judgeAutoPatch(path, cursorLineRef.current, sourceRef.current, patch);
    if (report.applied) {
      sourceRef.current = report.source;
      cursorLineRef.current = report.line + Math.max(report.inserted, 1);
      setTabs((current) =>
        current.map((tab) =>
          tab.path === path || tab.path === report.path
            ? { ...tab, source: report.source, saved: report.source }
            : tab,
        ),
      );
    }
    if (report.status === "both") {
      publishVeto(path, report.line > 0 ? report.line : cursorLineRef.current);
    }
    return report;
  }, []);

  const applyCode = useCallback(
    (code: string) => {
      updateActiveSource((previous) =>
        previous.trim().length === 0
          ? code
          : `${previous.trimEnd()}\n\n${code}`,
      );
    },
    [updateActiveSource],
  );

  const rows = useMemo<TokenInfo[]>(
    () => (analysis ? analysis.tokens.slice(0, MAX_ROWS) : []),
    [analysis],
  );

  if (vista === null) {
    return <p className="muted">Abriendo ventana…</p>;
  }
  if (vista !== "main") {
    return <DeskHost vista={vista} />;
  }

  return (
    <div className={`app${aiOpen ? " ai-open" : ""}${kernelOpen ? " kernel-open" : ""}${cockpitOpen ? " cockpit-open" : ""}`}>
      <header className="bar">
        <h1>Bara IDE</h1>
        <span className="tag">kernel v0.1.0-kernel · Shoresh</span>
        <span className={`kernel-pill kernel-pill-${kernelTone(kernelPill)}`}>kernel {kernelPill}</span>
        <span className="grow" />
        <span className="status">
          {importing
            ? cloneProgress ?? "clonando…"
            : workspaceLoading
              ? "sincronizando workspace…"
              : saving
                ? "guardando…"
                : busy
                  ? "analizando…"
                  : "workspace en sincronía"}
        </span>
        <button type="button" onClick={() => setKernelOpen(!kernelOpen)}>
          {kernelOpen ? "ocultar núcleo" : "núcleo AETHER-Ω"}
        </button>
        <button type="button" onClick={() => setCockpitOpen(!cockpitOpen)}>
          {cockpitOpen ? "ocultar cockpit" : "telemetría"}
        </button>
        <button type="button" onClick={() => setVisualOpen(!visualOpen)}>
          {visualOpen ? "ocultar lienzo" : "lienzo visual"}
        </button>
        <button type="button" onClick={() => setAiOpen(!aiOpen)}>
          {aiOpen ? "ocultar asistente" : "asistente"}
        </button>
        <button type="button" onClick={() => void openDeskWindow("topology").catch((reason: unknown) => setError(describeError(reason)))}>
          ventana topología
        </button>
        <button type="button" onClick={() => void openDeskWindow("autopoiesis").catch((reason: unknown) => setError(describeError(reason)))}>
          ventana ledger
        </button>
        <button type="button" onClick={() => void openDeskWindow("telemetry").catch((reason: unknown) => setError(describeError(reason)))}>
          ventana cockpit
        </button>
        <button type="button" onClick={() => void openDeskWindow("ai-workspace").catch((reason: unknown) => setError(describeError(reason)))}>
          ventana IA
        </button>
      </header>
      {idle ? (
        <div className="idle-note" role="status">
          <span>{idle.message}</span>
          <button
            type="button"
            onClick={() => {
              void idleApply().finally(() => setIdle(null));
            }}
          >
            transmutar
          </button>
          <button
            type="button"
            onClick={() => {
              void idleDismiss().finally(() => setIdle(null));
            }}
          >
            ahora no
          </button>
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      <main className="grid">
        <section className="pane editor-pane">
          <div className="editor-shell">
            <WorkspaceSidebar
              root={workspaceRoot}
              tree={workspace}
              loading={workspaceLoading || importing}
              activePath={activePath}
              onPickFolder={() => {
                void pickFolder();
              }}
              onClone={() => setShowWelcome(true)}
              onRefresh={() => {
                void refreshWorkspace();
              }}
              onOpenFile={(entry) => {
                void openWorkspaceFile(entry);
              }}
            />

            <div className="editor-main">
              <div className="editor-stage">
              {showWelcome ? (
                <WelcomeGate
                  busy={workspaceLoading || importing}
                  progress={cloneProgress}
                  onOpenFolder={() => {
                    void pickFolder();
                  }}
                  onClone={(url) => {
                    void cloneRepository(url);
                  }}
                  onDismiss={() => setShowWelcome(false)}
                />
              ) : null}
              <div className="tabs" role="tablist" aria-label="Documentos abiertos">
                {tabs.map((tab) => {
                  const active = tab.path === activePath;
                  const unsaved = tab.source !== tab.saved;
                  return (
                    <div className={`tab${active ? " active" : ""}`} key={tab.path}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className="tab-name"
                        title={tab.path}
                        onClick={() => setActivePath(tab.path)}
                      >
                        {unsaved ? <span className="dirty-dot" aria-hidden="true" /> : null}
                        {tab.name}
                      </button>
                      <button
                        type="button"
                        className="tab-close"
                        aria-label={`Cerrar ${tab.name}`}
                        title="Cerrar pestaña"
                        onClick={() => closeTab(tab.path)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {tabs.length === 0 ? (
                  <span className="muted tab-empty">
                    Abre un documento <code>.bara</code> del explorador.
                  </span>
                ) : null}
              </div>

              <div className="row editor-toolbar">
                <span className="status" title={origin}>
                  {activeTab ? origin : "sin documento"}
                  {dirty ? " · sin guardar" : ""}
                  {activeTab && !activeTab.path.endsWith(".bara") ? " · lectura" : ""}
                </span>
                <span className="grow" />
                <button
                  type="button"
                  disabled={!dirty || saving || (activeTab !== null && !activeTab.path.endsWith(".bara"))}
                  onClick={() => {
                    void saveActive();
                  }}
                  title="Guardar el documento activo (Ctrl+S)"
                >
                  {saving ? "Guardando…" : "Guardar"}
                </button>
              </div>

              <BaraEditor
                value={source}
                path={activePath ?? ""}
                revealLine={reveal !== null && reveal.path === activePath ? reveal.line : null}
                revealToken={reveal?.token ?? 0}
                onChange={updateActiveSource}
                onSave={() => {
                  void saveActive();
                }}
                onCursor={(line) => {
                  cursorLineRef.current = line;
                }}
              />
              </div>
              <details className="fold console-fold" open>
                <summary>Consola del oráculo</summary>
              <KernelConsole
                lines={consoleLog}
                busy={busy}
                lattice={lattice}
                current={oracle?.timelineObservation ?? null}
                onSubmit={(line) => {
                  void converse(line);
                }}
                onRecipe={(recipe) => {
                  void runRecipe(recipe);
                }}
              />
              </details>
            </div>
          </div>
        </section>

        <section className="pane">
          <details className="fold" open>
            <summary>Resumen</summary>
          {analysis ? (
            <SummaryPanel analysis={analysis} />
          ) : (
            <p className="muted">Sin documento analizado.</p>
          )}
          </details>
          <details className="fold" open>
            <summary>Inventario de raíces</summary>
          {analysis && analysis.roots.length > 0 ? (
            <ul className="roots">
              {analysis.roots.map((root) => (
                <li key={root.glyph}>
                  <span className="glyph">{root.glyph}</span>
                  <span className="meaning">{root.meaning}</span>
                  <span className="count">×{root.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Ninguna raíz reconocida.</p>
          )}
          </details>
          <details className="fold" open>
            <summary>Catálogo del kernel</summary>
          <ul className="roots">
            {catalogue.map((entry) => (
              <li key={entry.glyph}>
                <span className="glyph">{entry.glyph}</span>
                <span className="meaning">{entry.meaning}</span>
              </li>
            ))}
          </ul>
          </details>
        </section>

        <section className="pane">
          <details className="fold" open>
            <summary>Oráculo del kernel</summary>
          <div className="row">
            <input
              className="path"
              value={query}
              spellCheck={false}
              placeholder="consulta en lengua natural o raíz Shoresh"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void askOracle();
              }}
            >
              Conversar
            </button>
            <button type="button" disabled={busy || !oracle} onClick={markTimeline}>
              Marcar
            </button>
            <button
              type="button"
              disabled={busy || marker === null}
              onClick={() => {
                void rollbackTimeline();
              }}
            >
              Δ⁻¹
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void closeOracle();
              }}
            >
              Cerrar sesión
            </button>
          </div>

          {lastTurn ? (
            <ul className="roots">
              <li>
                <span className="meaning">{lastTurn.reply}</span>
              </li>
              {lastTurn.roots ? (
                <li>
                  <span className="glyph">shoresh</span>
                  <span className="meaning">{lastTurn.roots}</span>
                  <span className="count">×{lastTurn.events}</span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="muted">
              Sin turnos: el oráculo es el del kernel (su léxico y su runtime).
            </p>
          )}

          {oracle ? (
            <table className="summary">
              <tbody>
                <tr>
                  <th>turnos</th>
                  <td className="num">{oracle.turns}</td>
                </tr>
                <tr>
                  <th>eventos</th>
                  <td className="num">{oracle.events}</td>
                </tr>
                <tr>
                  <th>deltas Δ⁻¹</th>
                  <td className="num">
                    {oracle.deltas} (revertidos {oracle.reverted})
                  </td>
                </tr>
                <tr>
                  <th>marcador</th>
                  <td className="num">
                    {oracle.nextMarker}
                    {marker === null ? "" : ` · marcado ${marker}`}
                  </td>
                </tr>
                <tr>
                  <th>pila</th>
                  <td className="num">
                    {oracle.stackDepth} · temporal {oracle.timelineDepth}
                  </td>
                </tr>
                <tr>
                  <th>memoria</th>
                  <td className="num">
                    {oracle.memoryNodes} nodo(s) · {oracle.regions} región(es)
                  </td>
                </tr>
                <tr>
                  <th>autopoiesis</th>
                  <td className="num">
                    {oracle.axioms} axioma(s) · gen#{oracle.generation}
                  </td>
                </tr>
                <tr>
                  <th>malla</th>
                  <td className="num">
                    {oracle.meshPeers} peer(s) · {oracle.qubits} qubit(s)
                  </td>
                </tr>
                {oracle.timelineObservation ? (
                  <tr>
                    <th>cima ⊤/⊥</th>
                    <td className="num">
                      {oracle.timelineObservation.glyph}{" "}
                      {oracle.timelineObservation.name}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <p className="muted">Sesión del oráculo no disponible.</p>
          )}

          </details>
          <details className="fold" open>
            <summary>Biláttice de Belnap</summary>
          {lattice ? (
            <ul className="roots">
              {lattice.values.map((point) => (
                <li key={point.key}>
                  <span className="glyph">{point.observation.glyph}</span>
                  <span className="meaning">{point.observation.name}</span>
                  <span className="count">
                    ⊤{point.truth} ⊥{point.falsity}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Sin biláttice servida por el kernel.</p>
          )}
          </details>
        </section>

        <section className="pane tokens">
          <details className="fold" open>
            <summary>Tokens{analysis ? ` (${analysis.summary.total})` : ""}</summary>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Línea</th>
                  <th>Col</th>
                  <th>Clase</th>
                  <th>Lexema</th>
                  <th>Kernel</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((token, index) => (
                  <tr key={`${token.line}:${token.column}:${index}`}>
                    <td className="num">{token.line}</td>
                    <td className="num">{token.column}</td>
                    <td className={`cls ${token.class}`}>{CLASS_LABEL[token.class]}</td>
                    <td className="lexeme">{token.lexeme === "\n" ? "⏎" : token.lexeme}</td>
                    <td className="muted">{token.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {analysis && analysis.tokens.length > MAX_ROWS ? (
            <p className="muted">
              Se muestran las primeras {MAX_ROWS} de {analysis.tokens.length} tokens.
            </p>
          ) : null}
          </details>
        </section>
      </main>

      <PanelGuard name="núcleo" resetKey={kernelOpen}>
        <KernelPanel open={kernelOpen} source={source} />
      </PanelGuard>

      <CockpitPanel open={cockpitOpen} source={source} />

      <PanelGuard name="lienzo" resetKey={visualOpen}>
        <VisualBuilder open={visualOpen} onUseCode={applyCode} />
      </PanelGuard>

      <ChatPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        documentName={origin}
        documentSource={source}
        analysis={analysis}
        catalogue={catalogue}
        sample={sample}
        onUseCode={applyCode}
        onJudge={judgeSuggestion}
      />
    </div>
  );
}

/** Panel de recuentos por clase léxica del kernel. */
function SummaryPanel({ analysis }: { analysis: Analysis }) {
  const { summary } = analysis;
  const rows: Array<[string, number]> = [
    ["tokens totales", summary.total],
    ["raíces conocidas", summary.rootsKnown],
    ["raíces desconocidas", summary.rootsUnknown],
    ["identificadores", summary.identifiers],
    ["números", summary.numbers],
    ["cadenas", summary.strings],
    ["símbolos", summary.punctuation],
    ["saltos de línea", summary.newlines],
    ["centinelas EOF", summary.eof],
  ];

  return (
    <>
      <p className="muted">
        {analysis.sourceChars} caracteres · {analysis.sourceLines} líneas
      </p>
      <table className="summary">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td className="num">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

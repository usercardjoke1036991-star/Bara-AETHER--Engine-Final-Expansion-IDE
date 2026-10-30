import { listen } from "@tauri-apps/api/event";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

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
  contentHashOf,
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
import {
  confirmAutoPatch,
  emptyReport,
  judgeAutoPatch,
  undoAutoPatch,
} from "./autoApply";
import { idleApply, idleDismiss, idleProposal, type IdleNotice } from "./idle";
import { runWorkspaceRecipe, type RecipeName } from "./recipes";
import { publishVeto } from "./topology";
import { openDevtools, outlineTree, publishEditorContext } from "./editorBridge";
import { formatPatchDebug } from "./patchFlow";
import { dedupeTreeByPathKey, pathsEqual } from "./paths";
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
import { restoreMainWindow } from "./windowState";

/** Máximo de filas de tokens que se pintan (rendimiento del WebView). */
const MAX_ROWS = 1200;

/** Primer `.bara` del árbol (sugerencia al recibir un diff sin archivo). */
function firstBaraPath(entries: WorkspaceEntry[] | undefined): string | null {
  if (!entries) {
    return null;
  }
  for (const entry of entries) {
    if (entry.bara) {
      return entry.path;
    }
    const nested = firstBaraPath(entry.children);
    if (nested) {
      return nested;
    }
  }
  return null;
}

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
  /** Chat dockeado a la derecha (único chat). */
  const [aiOpen, setAiOpen] = useState(true);
  /** Explorador de archivos colapsable. */
  const [sideOpen, setSideOpen] = useState(true);
  /** Anchos flexibles de laterales (fracción CSS, no px fijos del layout). */
  const [sideFrac, setSideFrac] = useState(0.2);
  const [chatFrac, setChatFrac] = useState(0.28);
  /** Banner de parche visible aunque el chat estuviera cerrado. */
  const [patchBanner, setPatchBanner] = useState<string | null>(null);
  /** Sugerencia al recibir diff sin archivo activo. */
  const [suggestOpen, setSuggestOpen] = useState<string | null>(null);
  /** Sube al cambiar de carpeta: limpia diff en ChatPanel. */
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  /** Cajón Kernel inferior (cerrado por defecto). */
  const [kernelDockOpen, setKernelDockOpen] = useState(false);
  const [kernelTab, setKernelTab] = useState<
    "resumen" | "tokens" | "oraculo" | "catalogo" | "bilattice"
  >("resumen");
  /** Menú «Más» de acciones secundarias. */
  const [moreOpen, setMoreOpen] = useState(false);
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
    void restoreMainWindow();
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
    () => tabs.find((tab) => pathsEqual(tab.path, activePath)) ?? null,
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

  // Arranque: catálogo y genesis por separado — un fallo de belnap/oráculo
  // no debe dejar el catálogo vacío para el asistente.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [roots, genesis] = await Promise.all([kernelCatalogue(), sampleGenesis()]);
        if (!alive) {
          return;
        }
        setCatalogue(roots);
        setSample(genesis);
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
      try {
        const [belnap, session] = await Promise.all([belnapLattice(), oracleStatus()]);
        if (!alive) {
          return;
        }
        setLattice(belnap);
        setOracle(session);
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
  /** Al cambiar de carpeta: sin pestaña activa ni diff pendiente. */
  const resetEditorForRootChange = useCallback((reason: string) => {
    setTabs([]);
    setActivePath(null);
    setAnalysis(null);
    setWorkspaceEpoch((n) => n + 1);
    setPatchBanner("Carpeta cambiada: abre un archivo .bara para usar el editor.");
    console.info(
      formatPatchDebug({
        phase: "root_reset",
        detail: reason,
      }),
    );
    void publishEditorContext({
      path: "<editor>",
      name: "<editor>",
      source: "",
      analysis: null,
      treeOutline: "",
    }).catch(() => undefined);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    setWorkspaceLoading(true);
    try {
      const next = await workspaceTree();
      const deduped = {
        ...next,
        entries: dedupeTreeByPathKey(next.entries),
      };
      setWorkspace(deduped);
      setWorkspaceRoot(deduped.root);
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

  // Otra ventana (Asistencia) cambió la carpeta: reiniciar editor y diff.
  useEffect(() => {
    if (vista !== "main") {
      return undefined;
    }
    let cancel = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<{ root?: string; reason?: string }>(
          "workspace-root-changed",
          (event) => {
            if (cancel) {
              return;
            }
            resetEditorForRootChange(event.payload?.reason ?? "event");
            void refreshWorkspace();
          },
        );
      } catch {
        // Sin Tauri.
      }
    })();
    return () => {
      cancel = true;
      unlisten?.();
    };
  }, [vista, refreshWorkspace, resetEditorForRootChange]);

  useEffect(() => {
    if (vista !== "main") {
      return undefined;
    }
    let cancel = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<{ path?: string }>("workspace-file-changed", (event) => {
          if (cancel) {
            return;
          }
          const relative = event.payload?.path?.trim();
          if (!relative) {
            return;
          }
          const tab = tabsRef.current.find((item) => pathsEqual(item.path, relative));
          if (!tab) {
            return;
          }
          if (tab.source !== tab.saved) {
            setPatchBanner(
              `«${relative}» cambió en disco; tienes cambios locales sin guardar.`,
            );
            return;
          }
          void workspaceReadDocument(relative)
            .then((document) => {
              if (cancel) {
                return;
              }
              setTabs((current) =>
                current.map((item) =>
                  pathsEqual(item.path, relative)
                    ? { ...item, source: document.source, saved: document.source }
                    : item,
                ),
              );
              if (pathsEqual(pathRef.current, relative)) {
                sourceRef.current = document.source;
              }
            })
            .catch(() => undefined);
        });
      } catch {
        // Sin Tauri.
      }
    })();
    return () => {
      cancel = true;
      unlisten?.();
    };
  }, [vista]);

  const adoptWorkspace = useCallback(
    (next: WorkspaceTree) => {
      const deduped = {
        ...next,
        entries: dedupeTreeByPathKey(next.entries),
      };
      setWorkspace(deduped);
      setWorkspaceRoot(deduped.root);
      setError(null);
      setShowWelcome(false);
      setCloneProgress(null);
      resetEditorForRootChange(`adopt:${deduped.root}`);
    },
    [resetEditorForRootChange],
  );

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
      const existing = tabs.find((tab) => pathsEqual(tab.path, entry.path));
      if (existing) {
        setActivePath(existing.path);
        setPatchBanner(null);
        return;
      }
      if (workspaceRoot.length === 0) {
        setError("El workspace aún no tiene una raíz válida.");
        return;
      }

      setBusy(true);
      try {
        const document = await workspaceReadDocument(entry.path);
        setTabs((current) => {
          const hit = current.find((tab) => pathsEqual(tab.path, document.path));
          if (hit) {
            return current;
          }
          return [
            ...current,
            {
              path: document.path,
              name: document.name,
              source: document.source,
              saved: document.source,
            },
          ];
        });
        setActivePath(document.path);
        setPatchBanner(null);
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
      const document = await workspaceWriteDocument(
        activeTab.path,
        activeTab.source,
        contentHashOf(activeTab.saved),
      );
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

  // DevTools (F12 / Ctrl+Shift+I): sólo si el binario se compiló con `--features devtools`.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const open =
        event.key === "F12" ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "i");
      if (!open) {
        return;
      }
      event.preventDefault();
      void openDevtools().catch(() => {
        /* release sin feature: silencio */
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const treeOutline = useMemo(
    () => (workspace ? outlineTree(workspace.entries) : ""),
    [workspace],
  );

  // Publica el documento activo a ai-workspace (pestaña, guardado, análisis).
  useEffect(() => {
    if (vista !== "main" || !ready) {
      return;
    }
    const tab = activeTab;
    void publishEditorContext({
      path: tab?.path ?? "",
      name: tab?.name ?? "",
      source: tab?.source ?? "",
      analysis,
      treeOutline,
    }).catch(() => {
      /* el puente no está en el navegador puro */
    });
  }, [vista, ready, activeTab, analysis, treeOutline]);

  /** Receta del catálogo cerrado. No abre un shell. */
  const runRecipe = useCallback(async (recipe: RecipeName) => {
    setBusy(true);
    const live: string[] = [];
    setConsoleLog((current) => [
      ...current,
      { input: recipe, reply: "… ejecutando (salida en vivo)", roots: "" },
    ].slice(-40));
    const stop = await listen<{ stream: string; text: string; exitCode?: number }>(
      "recipe-output",
      (event) => {
        const chunk = event.payload;
        const prefix = chunk.stream === "stderr" ? "stderr" : chunk.stream === "exit" ? "exit" : "out";
        live.push(`[${prefix}] ${chunk.text}`);
        const reply = live.slice(-80).join("\n");
        setConsoleLog((current) => {
          const next = [...current];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i]?.input === recipe) {
              next[i] = { input: recipe, reply, roots: "" };
              break;
            }
          }
          return next.slice(-40);
        });
      },
    );
    try {
      const report = await runWorkspaceRecipe(recipe);
      const faults = report.lines.filter((line) => line.status === "false").slice(0, 6);
      const summary = [
        `${report.recipe} · salida ${report.exitCode} · ⊤ ${report.trueCount} · ⊥ ${report.falseCount} · ⊤∧⊥ ${report.bothCount} · ∅ ${report.neitherCount}${report.truncated ? " · recortado" : ""}${report.timedOut ? " · tiempo agotado" : ""}`,
        ...faults.map((line) => `${line.glyph} ${line.text}`),
        ...(live.length > 0 ? ["———", ...live.slice(-40)] : []),
      ].join("\n");
      setConsoleLog((current) => {
        const next = [...current];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i]?.input === recipe) {
            next[i] = { input: recipe, reply: summary, roots: "" };
            break;
          }
        }
        return next.slice(-40);
      });
    } catch (failure) {
      const reply = [describeError(failure), ...live.slice(-20)].join("\n");
      setConsoleLog((current) => {
        const next = [...current];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i]?.input === recipe) {
            next[i] = { input: recipe, reply, roots: "" };
            break;
          }
        }
        return next.slice(-40);
      });
    } finally {
      stop();
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

  const applyReportToEditor = useCallback((path: string, report: Awaited<ReturnType<typeof judgeAutoPatch>>) => {
    if (!report.applied || !report.source) {
      return;
    }
    sourceRef.current = report.source;
    cursorLineRef.current = report.line + Math.max(report.inserted, 1);
    setTabs((current) =>
      current.map((tab) =>
        pathsEqual(tab.path, path) || pathsEqual(tab.path, report.path)
          ? { ...tab, source: report.source, saved: report.source }
          : tab,
      ),
    );
  }, []);

  const judgeSuggestion = useCallback(async (patch: string) => {
    const path = pathRef.current;
    if (path === null || path.length === 0) {
      return emptyReport(cursorLineRef.current);
    }
    const report = await judgeAutoPatch(path, cursorLineRef.current, sourceRef.current, patch);
    if (report.status === "both") {
      publishVeto(path, report.line > 0 ? report.line : cursorLineRef.current);
    }
    return report;
  }, []);

  const confirmSuggestion = useCallback(async (patch: string, judgmentId: string) => {
    const path = pathRef.current;
    if (path === null || path.length === 0) {
      return emptyReport(cursorLineRef.current);
    }
    const report = await confirmAutoPatch(
      path,
      cursorLineRef.current,
      sourceRef.current,
      patch,
      judgmentId,
    );
    applyReportToEditor(path, report);
    if (report.status === "both") {
      publishVeto(path, report.line > 0 ? report.line : cursorLineRef.current);
    }
    return report;
  }, [applyReportToEditor]);

  const undoSuggestion = useCallback(
    async (path: string, backupPath: string) => {
      const report = await undoAutoPatch(path, backupPath);
      applyReportToEditor(path, report);
      return report;
    },
    [applyReportToEditor],
  );

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

  const suggestedBara = suggestOpen ?? firstBaraPath(workspace?.entries);

  return (
    <div
      className={`app ide-shell${aiOpen ? " ai-open" : ""}${sideOpen ? " side-open" : ""}${kernelDockOpen ? " kernel-dock-open" : ""}${kernelOpen ? " kernel-open" : ""}${cockpitOpen ? " cockpit-open" : ""}`}
      style={
        {
          "--side-frac": String(sideFrac),
          "--chat-frac": String(chatFrac),
        } as CSSProperties
      }
    >
      <header className="bar">
        <h1>Bara IDE</h1>
        <span className={`kernel-pill kernel-pill-${kernelTone(kernelPill)}`} title="Estado del proceso kernel">
          kernel {kernelPill}
        </span>
        <span className="grow" />
        <span className="status">
          {importing
            ? cloneProgress ?? "clonando…"
            : workspaceLoading
              ? "sincronizando…"
              : saving
                ? "guardando…"
                : busy
                  ? "analizando…"
                  : "listo"}
        </span>
        <button type="button" title="Mostrar u ocultar explorador" aria-pressed={sideOpen} onClick={() => setSideOpen((v) => !v)}>
          {sideOpen ? "Archivos" : "Archivos ▸"}
        </button>
        <button type="button" title="Mostrar u ocultar chat" aria-pressed={aiOpen} onClick={() => setAiOpen((v) => !v)}>
          {aiOpen ? "Chat" : "Chat ▸"}
        </button>
        <button
          type="button"
          title="Panel Kernel (tokens, oráculo, catálogo…)"
          aria-pressed={kernelDockOpen}
          onClick={() => setKernelDockOpen((v) => !v)}
        >
          Kernel
        </button>
        <div className="bar-more">
          <button type="button" title="Más herramientas" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
            Más ▾
          </button>
          {moreOpen ? (
            <ul className="bar-menu" role="menu">
              <li>
                <button type="button" role="menuitem" onClick={() => { setKernelOpen(true); setMoreOpen(false); }}>
                  Núcleo AETHER-Ω
                </button>
              </li>
              <li>
                <button type="button" role="menuitem" onClick={() => { setCockpitOpen(true); setMoreOpen(false); }}>
                  Telemetría
                </button>
              </li>
              <li>
                <button type="button" role="menuitem" onClick={() => { setVisualOpen(true); setMoreOpen(false); }}>
                  Lienzo visual
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void openDeskWindow("topology").catch((reason: unknown) => setError(describeError(reason)));
                    setMoreOpen(false);
                  }}
                >
                  Topología
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void openDeskWindow("autopoiesis").catch((reason: unknown) => setError(describeError(reason)));
                    setMoreOpen(false);
                  }}
                >
                  Ledger
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void openDeskWindow("ai-workspace").catch((reason: unknown) => setError(describeError(reason)));
                    setMoreOpen(false);
                  }}
                >
                  Adjuntar medios
                </button>
              </li>
            </ul>
          ) : null}
        </div>
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
      {patchBanner ? (
        <div className="patch-banner" role="status">
          <span>{patchBanner}</span>
          {suggestedBara && /abre un archivo \.bara/i.test(patchBanner) ? (
            <button
              type="button"
              title={`Abrir ${suggestedBara}`}
              onClick={() => {
                const hit = workspace?.entries && suggestedBara;
                if (!hit) {
                  return;
                }
                void openWorkspaceFile({
                  name: suggestedBara.split("/").pop() ?? suggestedBara,
                  path: suggestedBara,
                  kind: "file",
                  bara: true,
                  children: [],
                });
                setSuggestOpen(null);
                setPatchBanner(null);
              }}
            >
              ¿Abrir {suggestedBara}?
            </button>
          ) : null}
          <button type="button" onClick={() => setPatchBanner(null)}>
            ok
          </button>
        </div>
      ) : null}

      <div className="ide-body">
        {sideOpen ? (
          <>
            <aside className="ide-side" aria-label="Explorador">
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
            </aside>
            <div
              className="ide-split"
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar explorador"
              onMouseDown={(event) => {
                event.preventDefault();
                const startX = event.clientX;
                const start = sideFrac;
                const onMove = (ev: MouseEvent) => {
                  const delta = (ev.clientX - startX) / window.innerWidth;
                  setSideFrac(Math.min(0.36, Math.max(0.14, start + delta)));
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
          </>
        ) : null}

        <section className="pane editor-pane ide-center">
          <div className="editor-shell">
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
                  const saveLabel = unsaved ? "sin guardar" : "guardado";
                  return (
                    <div className={`tab${active ? " active" : ""}`} key={tab.path}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className="tab-name"
                        title={`${tab.path} · ${saveLabel}`}
                        aria-label={`${tab.name}, ${saveLabel}`}
                        onClick={() => setActivePath(tab.path)}
                      >
                        {unsaved ? <span className="dirty-dot" title="sin guardar" aria-hidden="true" /> : null}
                        {tab.name}
                        <span className="tab-save-state muted"> · {saveLabel}</span>
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
                  {dirty ? " · sin guardar" : activeTab ? " · guardado" : ""}
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
            </div>
          </div>
        </section>

        {aiOpen ? (
          <>
            <div
              className="ide-split"
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar chat"
              onMouseDown={(event) => {
                event.preventDefault();
                const startX = event.clientX;
                const start = chatFrac;
                const onMove = (ev: MouseEvent) => {
                  const delta = (startX - ev.clientX) / window.innerWidth;
                  setChatFrac(Math.min(0.42, Math.max(0.22, start + delta)));
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
            <aside className="ide-chat" aria-label="Asistente">
              <ChatPanel
                open={aiOpen}
                onClose={() => setAiOpen(false)}
                documentName={origin}
                documentSource={source}
                analysis={analysis}
                catalogue={catalogue}
                sample={sample}
                treeOutline={treeOutline}
                onUseCode={applyCode}
                onJudge={judgeSuggestion}
                onConfirm={confirmSuggestion}
                onUndo={undoSuggestion}
                acceptRemotePatches
                workspaceEpoch={workspaceEpoch}
                onEnsureOpen={() => setAiOpen(true)}
                onPatchNotice={(message) => {
                  setPatchBanner(message);
                  if (/abre un archivo \.bara/i.test(message)) {
                    setSuggestOpen(firstBaraPath(workspace?.entries));
                  }
                }}
              />
            </aside>
          </>
        ) : null}
      </div>

      <section className={`kernel-dock${kernelDockOpen ? " open" : ""}`} aria-label="Kernel">
        <div className="kernel-dock-tabs" role="tablist">
          {(
            [
              ["resumen", "Resumen"],
              ["tokens", "Tokens"],
              ["oraculo", "Oráculo"],
              ["catalogo", "Catálogo"],
              ["bilattice", "Bilattice"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={kernelTab === id}
              className={kernelTab === id ? "active" : undefined}
              onClick={() => {
                setKernelTab(id);
                setKernelDockOpen(true);
              }}
            >
              {label}
            </button>
          ))}
          <span className="grow" />
          <button type="button" title="Cerrar panel Kernel" onClick={() => setKernelDockOpen(false)}>
            {kernelDockOpen ? "▾" : "▴"}
          </button>
        </div>
        {kernelDockOpen ? (
          <div className="kernel-dock-body">
            {kernelTab === "resumen" ? (
              analysis ? <SummaryPanel analysis={analysis} /> : <p className="muted">Sin documento analizado.</p>
            ) : null}
            {kernelTab === "tokens" ? (
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
            ) : null}
            {kernelTab === "oraculo" ? (
              <div className="kernel-oraculo">
                <div className="row">
                  <input
                    className="path"
                    value={query}
                    spellCheck={false}
                    placeholder="consulta o raíz Shoresh"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button type="button" disabled={busy} onClick={() => void askOracle()}>
                    Conversar
                  </button>
                  <button type="button" disabled={busy || !oracle} onClick={markTimeline}>
                    Marcar
                  </button>
                  <button type="button" disabled={busy || marker === null} onClick={() => void rollbackTimeline()}>
                    Δ⁻¹
                  </button>
                  <button type="button" disabled={busy} onClick={() => void closeOracle()} title="Cerrar sesión del oráculo">
                    Cerrar
                  </button>
                </div>
                {lastTurn ? <p>{lastTurn.reply}</p> : <p className="muted">Sin turnos.</p>}
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
              </div>
            ) : null}
            {kernelTab === "catalogo" ? (
              <ul className="roots">
                {catalogue.map((entry) => (
                  <li key={entry.glyph}>
                    <span className="glyph">{entry.glyph}</span>
                    <span className="meaning">{entry.meaning}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {kernelTab === "bilattice" ? (
              lattice ? (
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
                <p className="muted">Sin biláttice.</p>
              )
            ) : null}
          </div>
        ) : null}
      </section>

      <PanelGuard name="núcleo" resetKey={kernelOpen}>
        <KernelPanel open={kernelOpen} source={source} />
      </PanelGuard>

      <CockpitPanel open={cockpitOpen} source={source} />

      <PanelGuard name="lienzo" resetKey={visualOpen}>
        <VisualBuilder open={visualOpen} onUseCode={applyCode} />
      </PanelGuard>
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

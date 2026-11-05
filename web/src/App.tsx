import { listen } from "@tauri-apps/api/event";

import { WORKSPACE_ROOT_CHANGED } from "./workspaceEvents";
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

import { statusFromAnalysis } from "./baraVerify";
import ActivityBar from "./shell/ActivityBar";
import BrandMark from "./shell/BrandMark";
import CommandPalette from "./shell/CommandPalette";
import { buildCommands } from "./shell/commands";
import {
  loadPanelLayout,
  savePanelLayout,
  type BottomTab,
  type SideMode,
} from "./shell/layoutState";
import PortalMenu, { type PortalMenuItem } from "./shell/PortalMenu";
import DraftConflictDialog from "./shell/DraftConflictDialog";
import UnsavedRootDialog, { unsavedTabs } from "./shell/UnsavedRootDialog";
import StatusBar from "./shell/StatusBar";
import { bottomHeightCss, escStopsAtField, EXPERT_VIEW_BLURBS, nextEscTarget } from "./shell/uxRules";

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
  clearDraft,
  draftLineDiff,
  listDraftsForProject,
  loadAutosaveEnabled,
  saveAutosaveEnabled,
  planDraftSave,
  saveDraft,
  takeDraft,
} from "./editorDrafts";
import { editorBadge, isEditorPath } from "./editorFiles";
import { confirmDeletePath } from "./fileOps";
import { diskCleanSafe, diskFreeCheck } from "./diskGuard";
import { problemsFromAnalysis, type EditorProblem } from "./problems";
import {
  contentHashOf,
  githubClone,
  workspaceCreateEntry,
  workspaceDeleteEntry,
  workspaceOpenDialog,
  workspaceReadDocument,
  workspaceReadSource,
  workspaceRenameEntry,
  workspaceTree,
  workspaceWriteDocument,
  type WorkspaceEntry,
  type WorkspaceTree,
} from "./workspace";
import GitPanel from "./components/GitPanel";
import ProblemsPanel from "./components/ProblemsPanel";
import LiveMapPanel from "./components/LiveMapPanel";
import {
  workspaceTrustGrant,
  workspaceTrustIsTrusted,
  workspaceTrustList,
  workspaceTrustRevoke,
} from "./workspaceTrust";
import { analysisStillCurrent } from "./analysisGate";
import { projectKey } from "./ai/projectKey";
import {
  confirmAutoPatch,
  emptyReport,
  judgeAutoPatch,
  undoAutoPatch,
} from "./autoApply";
import { idleApply, idleDismiss, idleProposal, type IdleNotice } from "./idle";
import { runWithBusy } from "./busyGuard";
import { runWorkspaceRecipe, type RecipeName } from "./recipes";
import { publishVeto } from "./topology";
import { openDevtools, outlineTree, proposeEditorPatch, publishEditorContext } from "./editorBridge";
import { formatPatchDebug } from "./patchFlow";
import { dedupeTreeByPathKey, pathsEqual } from "./paths";
import type { ReviewChromeLive } from "./reviewChrome";
import BaraEditor from "./components/BaraEditor";
import ChatPanel from "./components/ChatPanel";
import CockpitPanel from "./components/CockpitPanel";
import KernelConsole, { type ConsoleLine } from "./components/KernelConsole";
import KernelPanel from "./components/KernelPanel";
import VisualBuilder from "./components/VisualBuilder";
import DeskHost from "./components/DeskWindows";
import IdleNote from "./components/IdleNote";
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
  /** Huella del disco cuando nació el borrador. El guardado la usa en vez de `saved`. */
  baseHash?: string;
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
  /** M5: ruta pendiente de «¿Confías en esta carpeta?»; null = sin diálogo. */
  const [trustPrompt, setTrustPrompt] = useState<string | null>(null);
  /** M5: lista de carpetas confiadas (Ajustes). */
  const [trustedRoots, setTrustedRoots] = useState<string[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  /** Puerta de apertura: carpeta local o clon de GitHub. */
  const [showWelcome, setShowWelcome] = useState(true);
  const [importing, setImporting] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<string | null>(null);
  /** Documento de ejemplo del kernel (contexto del asistente). */
  const [sample, setSample] = useState("");
  const initialLayout = useMemo(() => loadPanelLayout(), []);
  /** Chat dockeado a la derecha (único chat). */
  const [aiOpen, setAiOpen] = useState(initialLayout.chatOpen);
  /** Panel lateral: archivos / buscar / ajustes (null = cerrado). */
  const [sideMode, setSideMode] = useState<SideMode>(initialLayout.sideMode);
  const sideOpen = sideMode !== null;
  /** Anchos flexibles de laterales (fracción CSS, no px fijos del layout). */
  const [sideFrac, setSideFrac] = useState(initialLayout.sideFrac);
  const [chatFrac, setChatFrac] = useState(initialLayout.chatFrac);
  /** Banner de parche visible aunque el chat estuviera cerrado. */
  const [patchBanner, setPatchBanner] = useState<string | null>(null);
  /** Aceptar/Rechazar/Deshacer elevados desde ChatPanel (siempre visibles). */
  const [reviewChrome, setReviewChrome] = useState<ReviewChromeLive | null>(null);
  /** Sugerencia al recibir diff sin archivo activo. */
  const [suggestOpen, setSuggestOpen] = useState<string | null>(null);
  /** Sube al cambiar de carpeta: limpia diff en ChatPanel. */
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  /** Panel inferior tipo terminal (cerrado por defecto). */
  const [bottomOpen, setBottomOpen] = useState(initialLayout.bottomOpen);
  const [bottomMaximized, setBottomMaximized] = useState(initialLayout.bottomMaximized);
  const [bottomFrac, setBottomFrac] = useState(initialLayout.bottomFrac);
  const [bottomTab, setBottomTab] = useState<BottomTab>(initialLayout.bottomTab);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [expertMenuOpen, setExpertMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const expertBtnRef = useRef<HTMLButtonElement | null>(null);
  const editorFocusRef = useRef<HTMLDivElement | null>(null);
  const [idle, setIdle] = useState<IdleNotice | null>(null);
  /** A9 — aviso si C: < 8 GB. */
  const [diskWarn, setDiskWarn] = useState<string | null>(null);
  /** A3: nombres sucios pendientes de Guardar / Descartar / Cancelar. */
  const [unsavedNames, setUnsavedNames] = useState<string[] | null>(null);
  const [draftConflict, setDraftConflict] = useState<{
    path: string;
    disk: string;
    draft: string;
    diskHash: string;
  } | null>(null);
  const [diskBusy, setDiskBusy] = useState(false);
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
  const rootContinue = useRef<(() => Promise<void>) | null>(null);

  /** Si hay pestañas sucias, no cambia de carpeta hasta Guardar / Descartar / Cancelar. */
  const guardRootChange = useCallback((run: () => Promise<void>) => {
    const names = unsavedTabs(tabsRef.current).map((tab) => tab.name);
    if (names.length > 0) {
      rootContinue.current = run;
      setUnsavedNames(names);
      return;
    }
    void run();
  }, []);

  useEffect(() => {
    void currentVista().then(setVista);
  }, []);

  useEffect(() => {
    void restoreMainWindow();
  }, []);

  useEffect(() => {
    savePanelLayout({
      sideMode,
      chatOpen: aiOpen,
      bottomOpen,
      bottomMaximized,
      bottomFrac,
      sideFrac,
      chatFrac,
      bottomTab,
    });
  }, [sideMode, aiOpen, bottomOpen, bottomMaximized, bottomFrac, sideFrac, chatFrac, bottomTab]);

  const toggleSide = useCallback((mode: Exclude<SideMode, null>) => {
    setSideMode((current) => (current === mode ? null : mode));
  }, []);

  const openBottomTab = useCallback((tab: BottomTab) => {
    setBottomTab(tab);
    setBottomOpen(true);
  }, []);

  const closeAllOverlays = useCallback(() => {
    setExpertMenuOpen(false);
    setPaletteOpen(false);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && key === "p") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (mod && key === "j") {
        event.preventDefault();
        setBottomOpen((v) => {
          if (v) {
            setBottomMaximized(false);
          }
          return !v;
        });
        return;
      }
      // Chat: Ctrl+Alt+A (teclado ES, sin depender de `Ñ`).
      if (mod && event.altKey && key === "a") {
        event.preventDefault();
        setAiOpen((v) => !v);
        return;
      }
      if (mod && key === "b") {
        event.preventDefault();
        toggleSide("files");
        return;
      }
      if (event.key === "Escape") {
        if (escStopsAtField(event)) {
          return;
        }
        const layer = nextEscTarget({
          menuOpen: expertMenuOpen,
          paletteOpen,
          bottomOpen,
          chatOpen: aiOpen,
          sideOpen,
        });
        if (layer === "none") {
          return;
        }
        event.preventDefault();
        if (layer === "menu") {
          setExpertMenuOpen(false);
        } else if (layer === "palette") {
          setPaletteOpen(false);
        } else if (layer === "bottom") {
          setBottomOpen(false);
          setBottomMaximized(false);
        } else if (layer === "chat") {
          setAiOpen(false);
        } else if (layer === "side") {
          setSideMode(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expertMenuOpen, paletteOpen, bottomOpen, aiOpen, sideOpen, toggleSide]);

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
    setPatchBanner("Carpeta cambiada: abre un archivo del proyecto para usar el editor.");
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

  const refreshTrustedRoots = useCallback(async () => {
    try {
      setTrustedRoots(await workspaceTrustList());
    } catch {
      setTrustedRoots([]);
    }
  }, []);

  /** M5: si la carpeta no está confiada, muestra el diálogo. */
  const maybePromptTrust = useCallback((root: string) => {
    if (!root.trim()) {
      setTrustPrompt(null);
      return;
    }
    void workspaceTrustIsTrusted(root)
      .then((trusted) => {
        setTrustPrompt(trusted ? null : root);
      })
      .catch(() => {
        setTrustPrompt(root);
      });
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
      maybePromptTrust(deduped.root);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [maybePromptTrust]);

  // El explorador arranca en paralelo con el catálogo y el documento de
  // ejemplo: un fallo del árbol no impide analizar el texto del editor.
  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  // A9 — aviso in-app si C: baja de 8 GB (misma regla que disk-guard / predist).
  useEffect(() => {
    if (vista !== "main") {
      return;
    }
    let alive = true;
    const tick = () => {
      void diskFreeCheck(8)
        .then((report) => {
          if (!alive) {
            return;
          }
          if (report.belowMin) {
            setDiskWarn(
              `C: tiene ${report.freeGb.toFixed(2)} GB libres (< ${report.minGb} GB). Puedes liberar target\\debug y caches seguras.`,
            );
          } else {
            setDiskWarn(null);
          }
        })
        .catch(() => {
          if (alive) {
            setDiskWarn(null);
          }
        });
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [vista]);

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
          WORKSPACE_ROOT_CHANGED,
          (event) => {
            if (cancel) {
              return;
            }
            guardRootChange(async () => {
              resetEditorForRootChange(event.payload?.reason ?? "event");
              await refreshWorkspace();
            });
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
  }, [vista, refreshWorkspace, resetEditorForRootChange, guardRootChange]);

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
      maybePromptTrust(deduped.root);
    },
    [maybePromptTrust, resetEditorForRootChange],
  );

  const acceptTrust = useCallback(async () => {
    if (!trustPrompt) {
      return;
    }
    try {
      await workspaceTrustGrant(trustPrompt);
      setTrustPrompt(null);
      await refreshTrustedRoots();
    } catch (failure) {
      setError(describeError(failure));
    }
  }, [refreshTrustedRoots, trustPrompt]);

  const declineTrust = useCallback(() => {
    setTrustPrompt(null);
  }, []);

  const finishRootChoice = useCallback(
    async (mode: "save" | "discard" | "cancel") => {
      const run = rootContinue.current;
      rootContinue.current = null;
      setUnsavedNames(null);
      if (mode === "cancel" || !run) {
        setPatchBanner("Cambio de carpeta cancelado: los cambios siguen en el editor.");
        return;
      }
      if (mode === "save") {
        setSaving(true);
        try {
          for (const tab of unsavedTabs(tabsRef.current)) {
            const document = await workspaceWriteDocument(
              tab.path,
              tab.source,
              contentHashOf(tab.saved),
            );
            setTabs((current) =>
              current.map((item) =>
                item.path === document.path ? { ...item, saved: document.source } : item,
              ),
            );
            if (workspaceRoot) {
              clearDraft(workspaceRoot, document.path);
            }
          }
        } catch (failure) {
          setError(describeError(failure));
          setSaving(false);
          return;
        }
        setSaving(false);
      }
      await run();
    },
    [workspaceRoot],
  );

  const revokeTrusted = useCallback(
    async (path: string) => {
      try {
        await workspaceTrustRevoke(path);
        await refreshTrustedRoots();
        if (workspaceRoot && pathsEqual(path, workspaceRoot)) {
          setTrustPrompt(workspaceRoot);
        }
      } catch (failure) {
        setError(describeError(failure));
      }
    },
    [refreshTrustedRoots, workspaceRoot],
  );

  /** El diálogo del sistema elige la carpeta; el WebView no manda la ruta. */
  const pickFolder = useCallback(async () => {
    guardRootChange(async () => {
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
    });
  }, [adoptWorkspace, guardRootChange]);

  /** URL allowlist en Rust, carpeta por diálogo, `git clone` sin shell. */
  const cloneRepository = useCallback(
    async (url: string) => {
      guardRootChange(async () => {
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
      });
    },
    [adoptWorkspace, guardRootChange],
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

  /** Abre un archivo editable del lote; si ya está en una pestaña, sólo la activa. */
  const openWorkspaceFile = useCallback(
    async (entry: WorkspaceEntry) => {
      if (!entry.bara && !isEditorPath(entry.path)) {
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

  /** Guarda una pestaña. `expectedHash` pisa el disco cuando el usuario ya vio el conflicto. */
  const persistTab = useCallback(
    async (path: string, source: string, expectedHash: string) => {
      setSaving(true);
      try {
        const document = await workspaceWriteDocument(path, source, expectedHash);
        setTabs((current) =>
          current.map((tab) =>
            tab.path === document.path
              ? { ...tab, saved: document.source, baseHash: undefined }
              : tab,
          ),
        );
        clearDraft(workspaceRoot, document.path);
        setDraftConflict(null);
        setError(null);
      } catch (failure) {
        setError(describeError(failure));
      } finally {
        setSaving(false);
      }
    },
    [workspaceRoot],
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

    const baseHash = activeTab.baseHash ?? contentHashOf(activeTab.saved);
    try {
      const onDisk = await workspaceReadDocument(activeTab.path);
      const plan = planDraftSave(baseHash, onDisk.source, activeTab.source);
      if (plan.kind === "conflict") {
        setDraftConflict({
          path: activeTab.path,
          disk: plan.disk,
          draft: plan.draft,
          diskHash: plan.diskHash,
        });
        return;
      }
      await persistTab(activeTab.path, activeTab.source, plan.expectedHash);
    } catch {
      await persistTab(activeTab.path, activeTab.source, baseHash);
    }
  }, [activeTab, persistTab, workspaceRoot]);

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

  // A5: persistir borradores locales; autoguardado opcional a disco.
  useEffect(() => {
    if (!activeTab || !workspaceRoot || activeTab.source === activeTab.saved) {
      return undefined;
    }
    saveDraft(
      workspaceRoot,
      activeTab.path,
      activeTab.source,
      activeTab.baseHash ?? contentHashOf(activeTab.saved),
    );
    if (!loadAutosaveEnabled()) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void saveActive();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [activeTab, workspaceRoot, saveActive]);

  // A5: al abrir raíz, ofrecer recuperar borradores no guardados (una vez por raíz).
  const offeredDraftsRootRef = useRef("");
  useEffect(() => {
    if (!workspaceRoot || vista !== "main") {
      return;
    }
    if (offeredDraftsRootRef.current === workspaceRoot) {
      return;
    }
    offeredDraftsRootRef.current = workspaceRoot;
    const pending = listDraftsForProject(workspaceRoot);
    if (pending.length === 0) {
      return;
    }
    const first = pending[0];
    if (
      !first ||
      !window.confirm(
        `Hay ${pending.length} borrador(es) sin guardar (p. ej. «${first.path}»). ¿Recuperar el más reciente?`,
      )
    ) {
      return;
    }
    const draft = takeDraft(workspaceRoot, first.path);
    if (!draft) {
      return;
    }
    setTabs((current) => {
      const hit = current.find((tab) => pathsEqual(tab.path, draft.path));
      if (hit) {
        return current.map((tab) =>
          pathsEqual(tab.path, draft.path)
            ? { ...tab, source: draft.source, baseHash: draft.savedHash }
            : tab,
        );
      }
      return [
        ...current,
        {
          path: draft.path,
          name: draft.path.split("/").pop() ?? draft.path,
          source: draft.source,
          saved: draft.source === "" ? " " : "",
          baseHash: draft.savedHash,
        },
      ];
    });
    setActivePath(draft.path);
    setPatchBanner(`Borrador recuperado: ${draft.path}`);
  }, [workspaceRoot, vista]);

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
    const live: string[] = [];
    setConsoleLog((current) => [
      ...current,
      { input: recipe, reply: "… ejecutando (salida en vivo)", roots: "" },
    ].slice(-40));
    // B2: listen dentro del mismo try/finally que libera busy.
    await runWithBusy(setBusy, async () => {
      let stop: (() => void) | undefined;
      try {
        stop = await listen<{ stream: string; text: string; exitCode?: number }>(
          "recipe-output",
          (event) => {
            const chunk = event.payload;
            const prefix =
              chunk.stream === "stderr" ? "stderr" : chunk.stream === "exit" ? "exit" : "out";
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
        const message = describeError(failure);
        setError(message);
        const reply = [message, ...live.slice(-20)].join("\n");
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
        stop?.();
      }
    });
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

  const rows = useMemo<TokenInfo[]>(
    () => (analysis ? analysis.tokens.slice(0, MAX_ROWS) : []),
    [analysis],
  );

  const searchHits = useMemo(() => {
    if (!workspace || !searchQuery.trim()) {
      return [] as WorkspaceEntry[];
    }
    const q = searchQuery.trim().toLocaleLowerCase("es");
    const hits: WorkspaceEntry[] = [];
    const walk = (entries: WorkspaceEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === "file" && entry.name.toLocaleLowerCase("es").includes(q)) {
          hits.push(entry);
        }
        if (entry.children.length) {
          walk(entry.children);
        }
      }
    };
    walk(workspace.entries);
    return hits.slice(0, 80);
  }, [workspace, searchQuery]);

  useEffect(() => {
    if (sideMode === "settings") {
      void refreshTrustedRoots();
    }
  }, [refreshTrustedRoots, sideMode]);

  const editorProblems = useMemo(
    () => problemsFromAnalysis(analysis, activePath ?? "", source),
    [analysis, activePath, source],
  );

  const openProblem = useCallback(
    (problem: EditorProblem) => {
      void openFromGraph(problem.path, problem.line).catch((reason: unknown) => {
        setError(describeError(reason));
      });
    },
    [openFromGraph],
  );

  if (vista === null) {
    return <p className="muted">Abriendo ventana…</p>;
  }
  if (vista !== "main") {
    return <DeskHost vista={vista} />;
  }

  const suggestedBara = suggestOpen ?? firstBaraPath(workspace?.entries);
  const verifiedStatus = analysis ? statusFromAnalysis(analysis) : null;
  const verifiedBool =
    verifiedStatus === null ? null : verifiedStatus === "verified";
  const badge = editorBadge(activePath ?? "", {
    verified: verifiedBool,
    clash: analysis ? analysis.summary.rootsUnknown > 0 : null,
  });
  const badgeTone =
    badge === "verificado" || badge === "equilibrado"
      ? "ok"
      : badge === "sin análisis"
        ? "neutral"
        : "warn";
  const titleLabel = activeTab?.name ?? workspace?.name ?? "Bara IDE";
  const statusBusy = importing
    ? (cloneProgress ?? "clonando…")
    : workspaceLoading
      ? "sincronizando…"
      : saving
        ? "guardando…"
        : busy
          ? "analizando…"
          : "listo";

  const expertItems: PortalMenuItem[] = [
    {
      id: "nucleo",
      label: EXPERT_VIEW_BLURBS.nucleo.title,
      description: EXPERT_VIEW_BLURBS.nucleo.blurb,
      onSelect: () => openBottomTab("nucleo"),
    },
    {
      id: "telemetria",
      label: EXPERT_VIEW_BLURBS.telemetria.title,
      description: EXPERT_VIEW_BLURBS.telemetria.blurb,
      onSelect: () => openBottomTab("telemetria"),
    },
    {
      id: "lienzo",
      label: EXPERT_VIEW_BLURBS.lienzo.title,
      description: EXPERT_VIEW_BLURBS.lienzo.blurb,
      onSelect: () => openBottomTab("lienzo"),
    },
    {
      id: "topologia",
      label: EXPERT_VIEW_BLURBS.topologia.title,
      description: EXPERT_VIEW_BLURBS.topologia.blurb,
      onSelect: () => openBottomTab("topologia"),
    },
    {
      id: "ledger",
      label: EXPERT_VIEW_BLURBS.ledger.title,
      description: EXPERT_VIEW_BLURBS.ledger.blurb,
      onSelect: () => openBottomTab("ledger"),
    },
  ];

  const commands = buildCommands({
    toggleSide,
    toggleChat: () => setAiOpen((v) => !v),
    toggleBottom: () => setBottomOpen((v) => !v),
    openBottomTab,
    openPalette: () => setPaletteOpen(true),
    openAssistMedia: () => {
      void openDeskWindow("ai-workspace").catch((reason: unknown) => setError(describeError(reason)));
    },
    save: () => {
      void saveActive();
    },
    openFolder: () => {
      void pickFolder();
    },
    focusEditor: () => {
      editorFocusRef.current?.focus();
    },
    maximizeBottom: () => {
      setBottomOpen(true);
      setBottomMaximized(true);
    },
    minimizeBottom: () => {
      setBottomOpen(true);
      setBottomMaximized(false);
      setBottomFrac(0.15);
    },
    closeBottom: () => {
      setBottomOpen(false);
      setBottomMaximized(false);
    },
    closeMenus: closeAllOverlays,
  });

  const bottomTabs: Array<[BottomTab, string]> = [
    ["resumen", "Resumen"],
    ["tokens", "Tokens"],
    ["problemas", `Problemas${editorProblems.length ? ` (${editorProblems.length})` : ""}`],
    ["git", "Git"],
    ["mapa", "Mapa"],
    ["oraculo", "Oráculo"],
    ["catalogo", "Catálogo"],
    ["bilattice", "Bilattice"],
    ["telemetria", "Telemetría"],
    ["topologia", "Topología"],
    ["ledger", "Ledger"],
    ["lienzo", "Lienzo"],
    ["nucleo", "Núcleo"],
  ];

  return (
    <div
      className={`app ide-shell${aiOpen ? " ai-open" : ""}${sideOpen ? " side-open" : ""}${bottomOpen ? " bottom-open" : ""}`}
      style={
        {
          "--side-frac": String(sideFrac),
          "--chat-frac": String(chatFrac),
          "--bottom-h": bottomHeightCss(bottomOpen, bottomMaximized, bottomFrac),
        } as CSSProperties
      }
    >
      {draftConflict ? (
        <DraftConflictDialog
          path={draftConflict.path}
          diff={draftLineDiff(draftConflict.disk, draftConflict.draft)}
          busy={saving}
          onOverwrite={() => {
            const live = tabsRef.current.find((tab) => tab.path === draftConflict.path);
            void persistTab(
              draftConflict.path,
              live?.source ?? draftConflict.draft,
              draftConflict.diskHash,
            );
          }}
          onCancel={() => setDraftConflict(null)}
        />
      ) : null}
      {unsavedNames ? (
        <UnsavedRootDialog
          names={unsavedNames}
          busy={saving}
          onSave={() => void finishRootChoice("save")}
          onDiscard={() => void finishRootChoice("discard")}
          onCancel={() => void finishRootChoice("cancel")}
        />
      ) : null}
      {trustPrompt ? (
        <div className="trust-dialog" role="dialog" aria-modal="true" aria-labelledby="trust-title">
          <div className="trust-dialog-card">
            <h2 id="trust-title">¿Confías en esta carpeta?</h2>
            <p className="muted">
              Sin confianza no se ejecuta ninguna receta (check, test, typecheck). El código se
              puede editar; sólo se bloquea el spawn.
            </p>
            <code className="trust-path">{trustPrompt}</code>
            <div className="row trust-actions">
              <button type="button" className="trust-yes" onClick={() => void acceptTrust()}>
                Confiar
              </button>
              <button type="button" onClick={declineTrust}>
                No
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <header className="title-bar">
        <BrandMark size={28} variant="mark" title="AETHER-Ω" className="title-brand" />
        <h1 title={workspaceRoot || "Bara IDE"}>{titleLabel}</h1>
        <span className={`kernel-pill kernel-pill-${kernelTone(kernelPill)}`} title="Estado del proceso kernel">
          kernel {kernelPill}
        </span>
        <span className="status title-busy">{statusBusy}</span>
        <span className="grow" />
        <button
          type="button"
          title="Paleta de comandos (Ctrl+Shift+P)"
          onClick={() => setPaletteOpen(true)}
        >
          Paleta
        </button>
        <button
          type="button"
          title="Mostrar u ocultar asistente (Ctrl+Alt+A)"
          aria-pressed={aiOpen}
          onClick={() => setAiOpen((v) => !v)}
        >
          {aiOpen ? "Chat" : "Chat ▸"}
        </button>
      </header>
      {idle ? (
        <IdleNote
          message={idle.message}
          onApply={() => {
            void idleApply()
              .catch((failure: unknown) => {
                setError(describeError(failure));
              })
              .finally(() => setIdle(null));
          }}
          onDismiss={() => {
            void idleDismiss()
              .catch((failure: unknown) => {
                setError(describeError(failure));
              })
              .finally(() => setIdle(null));
          }}
        />
      ) : null}

      {error ? <div className="error">{error}</div> : null}
      {diskWarn ? (
        <div className="disk-warn" role="status">
          <span>{diskWarn}</span>
          <button
            type="button"
            disabled={diskBusy || !workspaceRoot}
            onClick={() => {
              setDiskBusy(true);
              void diskCleanSafe(8)
                .then((report) => {
                  setDiskWarn(
                    `Limpieza: ${report.freeGbBefore.toFixed(2)} → ${report.freeGbAfter.toFixed(2)} GB libres (≈${report.freedGb.toFixed(2)} GB). ${report.detail}`,
                  );
                })
                .catch((reason: unknown) => setError(describeError(reason)))
                .finally(() => setDiskBusy(false));
            }}
          >
            {diskBusy ? "Limpiando…" : "Liberar espacio seguro"}
          </button>
        </div>
      ) : null}
      {patchBanner || reviewChrome ? (
        <div
          className={`patch-banner${reviewChrome ? " patch-banner-review" : ""}`}
          role="status"
          aria-label={reviewChrome ? "Revisión del parche" : "Aviso"}
        >
          <span>{patchBanner || reviewChrome?.notice}</span>
          {suggestedBara && patchBanner && /abre un archivo \.bara/i.test(patchBanner) ? (
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
          {reviewChrome?.showAccept ? (
            <button type="button" className="patch-banner-accept" onClick={reviewChrome.accept}>
              Aceptar
            </button>
          ) : null}
          {reviewChrome?.showReject ? (
            <button type="button" onClick={reviewChrome.reject}>
              Rechazar
            </button>
          ) : null}
          {reviewChrome?.showUndo ? (
            <button
              type="button"
              title={reviewChrome.undoLabel || "Deshacer"}
              onClick={reviewChrome.undo}
            >
              Deshacer
            </button>
          ) : null}
          {patchBanner && !reviewChrome ? (
            <button type="button" onClick={() => setPatchBanner(null)}>
              ok
            </button>
          ) : null}
          {patchBanner && reviewChrome ? (
            <button type="button" title="Ocultar aviso" onClick={() => setPatchBanner(null)}>
              ok
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="ide-workbench">
        <ActivityBar
          sideMode={sideMode}
          expertOpen={expertMenuOpen}
          expertAnchorRef={expertBtnRef}
          onToggleSide={toggleSide}
          onKernel={() => {
            setBottomOpen((v) => !v);
            if (!bottomOpen) {
              setBottomTab("resumen");
            }
          }}
          onAssist={() => {
            void openDeskWindow("ai-workspace").catch((reason: unknown) =>
              setError(describeError(reason)),
            );
          }}
          onExpert={() => setExpertMenuOpen((v) => !v)}
        />
        <PortalMenu
          open={expertMenuOpen}
          anchor={expertBtnRef.current}
          items={expertItems}
          onClose={() => setExpertMenuOpen(false)}
        />

        {sideOpen ? (
          <>
            <aside className="ide-side" aria-label="Panel lateral">
              {sideMode !== "files" ? (
                <div className="side-head">
                  <strong>{sideMode === "search" ? "Buscar" : "Ajustes"}</strong>
                  <button
                    type="button"
                    className="side-close"
                    title="Cerrar panel lateral"
                    aria-label="Cerrar panel lateral"
                    onClick={() => setSideMode(null)}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              {sideMode === "files" ? (
                <WorkspaceSidebar
                  root={workspaceRoot}
                  tree={workspace}
                  loading={workspaceLoading || importing}
                  activePath={activePath}
                  onPickFolder={() => {
                    void pickFolder();
                  }}
                  onClone={() => {
                    const url = window.prompt("Repositorio de GitHub (HTTPS o SSH)");
                    const next = url?.trim() ?? "";
                    if (next) {
                      void cloneRepository(next);
                    }
                  }}
                  onRefresh={() => {
                    void refreshWorkspace();
                  }}
                  onOpenFile={(entry) => {
                    void openWorkspaceFile(entry);
                  }}
                  onCreateFile={() => {
                    const name = window.prompt(
                      "Ruta relativa del archivo nuevo (ej. src/nota.md)",
                    );
                    const relative = name?.trim() ?? "";
                    if (!relative) {
                      return;
                    }
                    void workspaceCreateEntry(relative, "file")
                      .then(async (doc) => {
                        await refreshWorkspace();
                        void openWorkspaceFile({
                          name: doc.name,
                          path: doc.path,
                          kind: "file",
                          bara: doc.path.toLowerCase().endsWith(".bara"),
                          children: [],
                        });
                      })
                      .catch((reason: unknown) => setError(describeError(reason)));
                  }}
                  onCreateDir={() => {
                    const name = window.prompt("Ruta relativa de la carpeta nueva");
                    const relative = name?.trim() ?? "";
                    if (!relative) {
                      return;
                    }
                    void workspaceCreateEntry(relative, "dir")
                      .then(() => refreshWorkspace())
                      .catch((reason: unknown) => setError(describeError(reason)));
                  }}
                  onRenameActive={() => {
                    if (!activePath) {
                      return;
                    }
                    const next = window.prompt("Nueva ruta relativa", activePath);
                    const to = next?.trim() ?? "";
                    if (!to || to === activePath) {
                      return;
                    }
                    void workspaceRenameEntry(activePath, to)
                      .then(async () => {
                        setTabs((current) =>
                          current.map((tab) =>
                            pathsEqual(tab.path, activePath)
                              ? {
                                  ...tab,
                                  path: to,
                                  name: to.split("/").pop() ?? to,
                                }
                              : tab,
                          ),
                        );
                        setActivePath(to);
                        await refreshWorkspace();
                      })
                      .catch((reason: unknown) => setError(describeError(reason)));
                  }}
                  onDeleteActive={() => {
                    if (!activePath) {
                      return;
                    }
                    if (!confirmDeletePath(activePath)) {
                      return;
                    }
                    void workspaceDeleteEntry(activePath)
                      .then(async () => {
                        const removed = activePath;
                        setTabs((current) => {
                          const next = current.filter((tab) => !pathsEqual(tab.path, removed));
                          setActivePath(next[0]?.path ?? null);
                          return next;
                        });
                        if (workspaceRoot) {
                          clearDraft(workspaceRoot, removed);
                        }
                        await refreshWorkspace();
                      })
                      .catch((reason: unknown) => setError(describeError(reason)));
                  }}
                />
              ) : null}
              {sideMode === "search" ? (
                <div className="side-search">
                  <input
                    className="path"
                    value={searchQuery}
                    placeholder="Nombre de archivo…"
                    aria-label="Buscar archivo"
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <ul className="search-hits">
                    {searchHits.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          title={entry.path}
                          onClick={() => {
                            void openWorkspaceFile(entry);
                          }}
                        >
                          {entry.path}
                        </button>
                      </li>
                    ))}
                    {searchQuery.trim() && searchHits.length === 0 ? (
                      <li className="muted">Sin coincidencias</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
              {sideMode === "settings" ? (
                <div className="side-settings">
                  <p className="muted">Ajustes rápidos del escritorio.</p>
                  <label className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      defaultChecked={loadAutosaveEnabled()}
                      onChange={(event) => {
                        saveAutosaveEnabled(event.target.checked);
                      }}
                    />
                    Autoguardado a disco (on/off)
                  </label>
                  <button type="button" onClick={() => setAiOpen(true)}>
                    Abrir chat y ajustes de IA
                  </button>
                  <button type="button" onClick={() => setPaletteOpen(true)}>
                    Abrir paleta de comandos
                  </button>
                  <p className="muted">Tipografía mínima 14px · contraste AA · Esc cierra paneles.</p>
                  <section className="trust-settings" aria-label="Carpetas de confianza">
                    <h3>Carpetas de confianza</h3>
                    <p className="muted">
                      Sin confianza no se ejecutan recetas (check / test / typecheck).
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void refreshTrustedRoots();
                      }}
                    >
                      Actualizar lista
                    </button>
                    {trustedRoots.length === 0 ? (
                      <p className="muted">Ninguna carpeta confiada.</p>
                    ) : (
                      <ul className="trust-list">
                        {trustedRoots.map((path) => (
                          <li key={path}>
                            <code className="inline-code" title={path}>
                              {path}
                            </code>
                            <button type="button" onClick={() => void revokeTrusted(path)}>
                              Revocar
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              ) : null}
            </aside>
            <div
              className="ide-split"
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar panel lateral"
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

        <div className="ide-main-column">
          <div className="ide-center-row">
            {/* Modelo mockup: Asistente al CENTRO · editor a la DERECHA.
                Chat siempre montado (listener propose-patch). Sticky review intacto. */}
            <aside
              className={`ide-chat ide-chat-main${aiOpen ? "" : " is-closed"}`}
              aria-label="Asistente"
              aria-hidden={!aiOpen}
              hidden={!aiOpen}
            >
              <ChatPanel
                open={aiOpen}
                onClose={() => setAiOpen(false)}
                documentName={origin}
                documentSource={source}
                analysis={analysis}
                catalogue={catalogue}
                sample={sample}
                treeOutline={treeOutline}
                onJudge={judgeSuggestion}
                onConfirm={confirmSuggestion}
                onUndo={undoSuggestion}
                acceptRemotePatches
                workspaceEpoch={workspaceEpoch}
                projectId={projectKey(workspaceRoot)}
                onEnsureOpen={() => setAiOpen(true)}
                onPatchNotice={(message) => {
                  setPatchBanner(message);
                  if (/abre un archivo \.bara/i.test(message)) {
                    setSuggestOpen(firstBaraPath(workspace?.entries));
                  }
                }}
                onReviewChrome={setReviewChrome}
              />
            </aside>

            {aiOpen ? (
              <div
                className="ide-split"
                role="separator"
                aria-orientation="vertical"
                aria-label="Redimensionar asistente"
                onMouseDown={(event) => {
                  event.preventDefault();
                  const startX = event.clientX;
                  const start = chatFrac;
                  const onMove = (ev: MouseEvent) => {
                    // Chat a la izquierda del editor: arrastrar a la derecha ensancha el chat.
                    const delta = (ev.clientX - startX) / window.innerWidth;
                    setChatFrac(Math.min(0.62, Math.max(0.32, start + delta)));
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              />
            ) : null}

            <section
              className="pane editor-pane ide-center"
              ref={editorFocusRef}
              tabIndex={-1}
              aria-label="Editor"
            >
              <div className="editor-shell">
                <div className="editor-main">
                  <div className="editor-stage">
                    {showWelcome && !workspaceRoot ? (
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
                              {unsaved ? (
                                <span className="dirty-dot" title="sin guardar" aria-hidden="true" />
                              ) : null}
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
                          Abre un documento del explorador (.bara, .rs, .ts, .md…).
                        </span>
                      ) : null}
                    </div>

                    <div className="row editor-toolbar">
                      <span className="status" title={origin}>
                        {activeTab ? origin : "sin documento"}
                        {dirty ? " · sin guardar" : activeTab ? " · guardado" : ""}
                      </span>
                      <span className="grow" />
                      <button
                        type="button"
                        disabled={!dirty || saving}
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
                      revealLine={
                        reveal !== null && reveal.path === activePath ? reveal.line : null
                      }
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
          </div>

          <section
            className={`bottom-panel${bottomOpen ? " open" : ""}${bottomMaximized ? " maximized" : ""}`}
            aria-label="Panel inferior"
          >
            <div
              className="bottom-resize"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Redimensionar panel inferior"
              onMouseDown={(event) => {
                event.preventDefault();
                if (!bottomOpen) {
                  setBottomOpen(true);
                }
                setBottomMaximized(false);
                const startY = event.clientY;
                const start = bottomFrac;
                const onMove = (ev: MouseEvent) => {
                  const delta = (startY - ev.clientY) / window.innerHeight;
                  setBottomFrac(Math.min(0.6, Math.max(0.15, start + delta)));
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            />
            <div className="bottom-tabs" role="tablist">
              {bottomTabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={bottomTab === id}
                  className={bottomTab === id ? "active" : undefined}
                  title={label}
                  onClick={() => openBottomTab(id)}
                >
                  {label}
                </button>
              ))}
              <span className="grow" />
              <button
                type="button"
                title="Minimizar panel"
                aria-label="Minimizar panel"
                onClick={() => {
                  setBottomOpen(true);
                  setBottomMaximized(false);
                  setBottomFrac(0.15);
                }}
              >
                ▬
              </button>
              <button
                type="button"
                title={bottomMaximized ? "Restaurar panel" : "Maximizar panel (60%)"}
                aria-label={bottomMaximized ? "Restaurar panel" : "Maximizar panel"}
                onClick={() => {
                  setBottomOpen(true);
                  setBottomMaximized((v) => !v);
                }}
              >
                {bottomMaximized ? "❐" : "□"}
              </button>
              <button
                type="button"
                title="Cerrar panel (Ctrl+J)"
                aria-label="Cerrar panel inferior"
                onClick={() => {
                  setBottomOpen(false);
                  setBottomMaximized(false);
                }}
              >
                ×
              </button>
            </div>
            {bottomOpen ? (
              <div className="bottom-body">
                {bottomTab === "resumen" ? (
                  analysis ? (
                    <SummaryPanel analysis={analysis} />
                  ) : (
                    <p className="muted">Sin documento analizado.</p>
                  )
                ) : null}
                {bottomTab === "tokens" ? (
                  <div className="zone-scroll">
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
                            <td className="lexeme">
                              {token.lexeme === "\n" ? "⏎" : token.lexeme}
                            </td>
                            <td className="muted">{token.display}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {bottomTab === "problemas" ? (
                  <div className="zone-scroll problems-panel">
                    <ProblemsPanel problems={editorProblems} onOpen={openProblem} />
                  </div>
                ) : null}
                {bottomTab === "git" ? (
                  <div className="zone-scroll">
                    <GitPanel workspaceRoot={workspaceRoot} />
                  </div>
                ) : null}
                {bottomTab === "mapa" ? (
                  <div className="zone-scroll">
                    <LiveMapPanel
                      workspaceRoot={workspaceRoot}
                      focusPath={activePath ?? ""}
                    />
                  </div>
                ) : null}
                {bottomTab === "oraculo" ? (
                  <div className="kernel-oraculo zone-scroll">
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
                      <button
                        type="button"
                        disabled={busy || marker === null}
                        onClick={() => void rollbackTimeline()}
                      >
                        Δ⁻¹
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void closeOracle()}
                        title="Cerrar sesión del oráculo"
                      >
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
                {bottomTab === "catalogo" ? (
                  <ul className="roots zone-scroll">
                    {catalogue.map((entry) => (
                      <li key={entry.glyph}>
                        <span className="glyph">{entry.glyph}</span>
                        <span className="meaning">{entry.meaning}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {bottomTab === "bilattice" ? (
                  lattice ? (
                    <ul className="roots zone-scroll">
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
                {bottomTab === "telemetria" ? (
                  <div className="zone-scroll expert-embed">
                    <h3>{EXPERT_VIEW_BLURBS.telemetria.title}</h3>
                    <p className="muted">{EXPERT_VIEW_BLURBS.telemetria.blurb}</p>
                    <CockpitPanel open source={source} />
                  </div>
                ) : null}
                {bottomTab === "topologia" ? (
                  <div className="expert-embed">
                    <h3>{EXPERT_VIEW_BLURBS.topologia.title}</h3>
                    <p className="muted">{EXPERT_VIEW_BLURBS.topologia.blurb}</p>
                    <button
                      type="button"
                      onClick={() => {
                        void openDeskWindow("topology").catch((reason: unknown) =>
                          setError(describeError(reason)),
                        );
                      }}
                    >
                      Abrir ventana de topología
                    </button>
                  </div>
                ) : null}
                {bottomTab === "ledger" ? (
                  <div className="expert-embed">
                    <h3>{EXPERT_VIEW_BLURBS.ledger.title}</h3>
                    <p className="muted">{EXPERT_VIEW_BLURBS.ledger.blurb}</p>
                    <button
                      type="button"
                      onClick={() => {
                        void openDeskWindow("autopoiesis").catch((reason: unknown) =>
                          setError(describeError(reason)),
                        );
                      }}
                    >
                      Abrir ventana del ledger
                    </button>
                  </div>
                ) : null}
                {bottomTab === "lienzo" ? (
                  <div className="zone-scroll expert-embed">
                    <h3>{EXPERT_VIEW_BLURBS.lienzo.title}</h3>
                    <p className="muted">{EXPERT_VIEW_BLURBS.lienzo.blurb}</p>
                    <PanelGuard name="lienzo" resetKey={bottomTab === "lienzo"}>
                      <VisualBuilder
                        open
                        onUseCode={(code) => {
                          void proposeEditorPatch(code)
                            .then(() => setAiOpen(true))
                            .catch((reason: unknown) => setError(describeError(reason)));
                        }}
                      />
                    </PanelGuard>
                  </div>
                ) : null}
                {bottomTab === "nucleo" ? (
                  <div className="zone-scroll expert-embed">
                    <h3>{EXPERT_VIEW_BLURBS.nucleo.title}</h3>
                    <p className="muted">{EXPERT_VIEW_BLURBS.nucleo.blurb}</p>
                    <PanelGuard name="núcleo" resetKey={bottomTab === "nucleo"}>
                      <KernelPanel open source={source} />
                    </PanelGuard>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <StatusBar
        fileLabel={activeTab ? activeTab.path : "sin archivo"}
        kernel={kernelPill}
        badgeLabel={activeTab ? badge : "sin análisis"}
        badgeTone={activeTab ? badgeTone : "neutral"}
        tokenCount={analysis ? analysis.summary.total : null}
        problemCount={editorProblems.length}
        onFile={() => {
          editorFocusRef.current?.focus();
        }}
        onKernel={() => openBottomTab("resumen")}
        onVerified={() => openBottomTab("resumen")}
        onTokens={() => openBottomTab("tokens")}
        onProblems={() => openBottomTab("problemas")}
      />

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
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

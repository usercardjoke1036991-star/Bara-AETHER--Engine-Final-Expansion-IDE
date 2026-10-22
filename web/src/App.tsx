import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CLASS_LABEL,
  analyzeSource,
  belnapLattice,
  describeError,
  kernelCatalogue,
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
  workspaceDefaultRoot,
  workspaceReadDocument,
  workspaceTree,
  workspaceWriteDocument,
  type WorkspaceEntry,
  type WorkspaceTree,
} from "./workspace";
import BaraEditor from "./components/BaraEditor";
import ChatPanel from "./components/ChatPanel";
import CockpitPanel from "./components/CockpitPanel";
import KernelConsole, { type ConsoleLine } from "./components/KernelConsole";
import KernelPanel from "./components/KernelPanel";
import VisualBuilder from "./components/VisualBuilder";
import WorkspaceSidebar from "./components/WorkspaceSidebar";

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

export default function App() {
  /** Documentos abiertos; el activo se proyecta a `source`/`origin`. */
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [catalogue, setCatalogue] = useState<RootEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  /** Raíz canónica del explorador y su última enumeración. */
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceTree | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
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

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [tabs, activePath],
  );
  const source = activeTab?.source ?? "";
  const origin = activeTab?.path ?? "<editor>";
  const dirty = activeTab !== null && activeTab.source !== activeTab.saved;

  /** Invoca al backend del kernel y publica el resultado. */
  const runAnalysis = useCallback(async (text: string) => {
    setBusy(true);
    try {
      const result = await analyzeSource(text);
      setAnalysis(result);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
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

  /**
   * Enumera una raíz del workspace. Sin texto usa el directorio de
   * lanzamiento; el backend devuelve siempre la raíz canónica resultante.
   */
  const loadWorkspace = useCallback(async (root: string) => {
    setWorkspaceLoading(true);
    try {
      const requested = root.trim().length > 0 ? root : await workspaceDefaultRoot();
      const next = await workspaceTree(requested);
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
    void loadWorkspace("");
  }, [loadWorkspace]);

  // Análisis en vivo con retardo: no se invoca al kernel en cada tecla.
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void runAnalysis(source);
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready, source, runAnalysis]);

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
        const document = await workspaceReadDocument(workspaceRoot, entry.path);
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
        workspaceRoot,
        activeTab.path,
        activeTab.source,
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

  const applyCode = useCallback(
    (code: string) => {
      updateActiveSource((previous) =>
        previous.trim().length === 0
          ? code
          : `${previous.replace(/\s+$/, "")}\n\n${code}`,
      );
    },
    [updateActiveSource],
  );

  const rows = useMemo<TokenInfo[]>(
    () => (analysis ? analysis.tokens.slice(0, MAX_ROWS) : []),
    [analysis],
  );

  return (
    <div className={`app${aiOpen ? " ai-open" : ""}${kernelOpen ? " kernel-open" : ""}${cockpitOpen ? " cockpit-open" : ""}`}>
      <header className="bar">
        <h1>Bara IDE</h1>
        <span className="tag">kernel v0.1.0-kernel · Shoresh</span>
        <span className="grow" />
        <span className="status">
          {saving ? "guardando…" : busy ? "analizando…" : origin}
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
      </header>

      {error ? <div className="error">{error}</div> : null}

      <main className="grid">
        <section className="pane editor-pane">
          <div className="editor-shell">
            <WorkspaceSidebar
              root={workspaceRoot}
              tree={workspace}
              loading={workspaceLoading}
              activePath={activePath}
              onOpenRoot={(next) => {
                void loadWorkspace(next);
              }}
              onRefresh={() => {
                void loadWorkspace(workspaceRoot);
              }}
              onOpenFile={(entry) => {
                void openWorkspaceFile(entry);
              }}
            />

            <div className="editor-main">
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

              <BaraEditor value={source} onChange={updateActiveSource} />
              <KernelConsole
                lines={consoleLog}
                busy={busy}
                lattice={lattice}
                current={oracle?.timelineObservation ?? null}
                onSubmit={(line) => {
                  void converse(line);
                }}
              />
            </div>
          </div>
        </section>

        <section className="pane">
          <h2>Resumen</h2>
          {analysis ? (
            <SummaryPanel analysis={analysis} />
          ) : (
            <p className="muted">Sin documento analizado.</p>
          )}
          <h2>Inventario de raíces</h2>
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
          <h2>Catálogo del kernel</h2>
          <ul className="roots">
            {catalogue.map((entry) => (
              <li key={entry.glyph}>
                <span className="glyph">{entry.glyph}</span>
                <span className="meaning">{entry.meaning}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="pane">
          <h2>Oráculo del kernel</h2>
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

          <h2>Biláttice de Belnap</h2>
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
        </section>

        <section className="pane tokens">
          <h2>Tokens{analysis ? ` (${analysis.summary.total})` : ""}</h2>
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
        </section>
      </main>

      <KernelPanel open={kernelOpen} source={source} />

      <CockpitPanel open={cockpitOpen} source={source} />

      <VisualBuilder open={visualOpen} onUseCode={applyCode} />

      <ChatPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        documentName={origin}
        documentSource={source}
        analysis={analysis}
        catalogue={catalogue}
        sample={sample}
        onUseCode={applyCode}
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

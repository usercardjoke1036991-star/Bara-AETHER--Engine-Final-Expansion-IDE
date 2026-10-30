// Vistas de las ventanas secundarias.
//
// Comparten el mismo documento Vite. La etiqueta de la ventana elige el
// layout. Los números salen de los comandos ya tipados: el marco neuronal
// en snake_case y el informe de autopoiesis en camelCase.

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  kernelAutopoiesis,
  metalIr,
  type AutopoiesisReport,
  type MetalView,
} from "../aether";
import {
  analyzeSource,
  describeError,
  kernelCatalogue,
  sampleGenesis,
  type Analysis,
  type RootEntry,
} from "../engine";
import {
  getEditorContext,
  onEditorContext,
  outlineTree,
  readProjectFile,
  type EditorSnapshot,
} from "../editorBridge";
import { inspectMediaDialog } from "../media";
import {
  workspaceActivate,
  workspaceCloseRoot,
  workspaceOpenDialog,
  workspaceReadDocument,
  workspaceRoots,
  workspaceTree,
  workspaceWriteDocument,
  type WorkspaceEntry,
  type WorkspaceShelf,
  type WorkspaceTree,
} from "../workspace";
import type { DeskVista } from "../windows";
import ChatPanel from "./ChatPanel";
import CockpitPanel from "./CockpitPanel";
import FileTree from "./FileTree";
import TopologyGraph from "./TopologyGraph";

const MAX_TEXT_BYTES = 256 * 1024;

/** Título visible de cada vista. */
const TITLES: Record<Exclude<DeskVista, "main">, string> = {
  topology: "Topología",
  autopoiesis: "Autopoiesis y ledger",
  telemetry: "Cockpit telemétrico",
  "ai-workspace": "Asistencia multimodal",
};

export default function DeskHost({ vista }: { vista: Exclude<DeskVista, "main"> }) {
  return (
    <div className="desk">
      <header className="bar">
        <h1>{TITLES[vista]}</h1>
        <span className="tag">ventana {vista}</span>
      </header>
      {vista === "topology" ? <TopologyDesk /> : null}
      {vista === "autopoiesis" ? <AutopoiesisDesk /> : null}
      {vista === "telemetry" ? <TelemetryDesk /> : null}
      {vista === "ai-workspace" ? <AiDesk /> : null}
    </div>
  );
}

function TopologyDesk() {
  return (
    <section className="desk-body topo-desk">
      <TopologyGraph />
    </section>
  );
}

function TelemetryDesk() {
  const [source, setSource] = useState("");
  useEffect(() => {
    let stop: (() => void) | undefined;
    void getEditorContext()
      .then((snap) => setSource(snap.source))
      .catch(() => undefined);
    void onEditorContext((snap) => setSource(snap.source)).then((unlisten) => {
      stop = unlisten;
    });
    return () => {
      stop?.();
    };
  }, []);
  return (
    <section className="desk-body">
      <CockpitPanel open source={source} />
    </section>
  );
}

function AutopoiesisDesk() {
  const [source, setSource] = useState("");
  const [report, setReport] = useState<AutopoiesisReport | null>(null);
  const [metal, setMetal] = useState<MetalView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const project = useCallback((text: string) => {
    setError(null);
    void Promise.all([kernelAutopoiesis(text), metalIr(text, "cpu")])
      .then(([auto, metalView]) => {
        setReport(auto);
        setMetal(metalView);
      })
      .catch((reason: unknown) => setError(describeError(reason)));
  }, []);

  useEffect(() => {
    sampleGenesis()
      .then((sample) => {
        setSource(sample);
        project(sample);
      })
      .catch((reason: unknown) => setError(describeError(reason)));
  }, [project]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void getEditorContext()
      .then((snap) => {
        if (snap.source.trim().length > 0) {
          setSource(snap.source);
          project(snap.source);
        }
      })
      .catch(() => undefined);
    void onEditorContext((snap) => {
      if (snap.source.trim().length > 0) {
        setSource(snap.source);
        project(snap.source);
      }
    }).then((unlisten) => {
      stop = unlisten;
    });
    return () => {
      stop?.();
    };
  }, [project]);

  return (
    <section className="desk-body">
      <textarea
        className="desk-source"
        value={source}
        spellCheck={false}
        aria-label="Documento para el ledger"
        onChange={(event) => setSource(event.target.value)}
      />
      <button type="button" onClick={() => project(source)}>
        Proyectar ledger
      </button>
      {error ? <p className="error">{error}</p> : null}
      {report ? (
        <dl className="desk-facts">
          <div>
            <dt>Fase 1 · autopoiesis ⊤∧⊥ y puerta ZK (didáctica)</dt>
            <dd>
              {report.gate.didactic
                ? "simulación didáctica (no ZK criptográfico)"
                : "aviso: marcador didáctico ausente"}
            </dd>
          </div>
          <div>
            <dt>Atención total</dt>
            <dd>{report.attentionTotal}</dd>
          </div>
          <div>
            <dt>Raíz prioritaria</dt>
            <dd>{report.priorityRoot || "—"}</dd>
          </div>
          <div>
            <dt>Generación</dt>
            <dd>{report.generation}</dd>
          </div>
          <div>
            <dt>Contradicciones</dt>
            <dd>{report.contradictions}</dd>
          </div>
          <div>
            <dt>Veredicto</dt>
            <dd>{report.verdict}</dd>
          </div>
          <div>
            <dt>Malla</dt>
            <dd>
              {report.topology.nodes} nodos · cohesión {report.topology.cohesionMilli}
              {report.topology.alert ? " · ⊤∧⊥" : ""}
            </dd>
          </div>
        </dl>
      ) : null}
      {metal ? (
        <dl className="desk-facts">
          <div>
            <dt>Fase 2 · Metal-IR simulado (didáctico)</dt>
            <dd>
              {metal.label} · {metal.signature}
              {metal.didactic ? " · sin GPU/MMIO real" : " · aviso: marcador didáctico ausente"}
            </dd>
          </div>
        </dl>
      ) : null}
      {report && report.axioms.length > 0 ? (
        <table className="desk-table">
          <thead>
            <tr>
              <th>Raíz</th>
              <th>Atención</th>
              <th>Valencia</th>
            </tr>
          </thead>
          <tbody>
            {report.axioms.map((axiom) => (
              <tr key={`${axiom.root}-${axiom.generation}`}>
                <td>{axiom.root}</td>
                <td>{axiom.attention}</td>
                <td>{axiom.valence.key}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function AiDesk() {
  const [tree, setTree] = useState<WorkspaceTree | null>(null);
  const [shelf, setShelf] = useState<WorkspaceShelf | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState("<asistencia>");
  const [documentSource, setDocumentSource] = useState("");
  const [savedSource, setSavedSource] = useState("");
  const [videoName, setVideoName] = useState<string | null>(null);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<RootEntry[]>([]);
  const [sample, setSample] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [treeOutline, setTreeOutline] = useState("");
  const dirty =
    documentName.endsWith(".bara") && documentSource !== savedSource && !documentName.startsWith("<");

  const applySnapshot = useCallback((snap: EditorSnapshot) => {
    if (snap.path && !snap.path.startsWith("<")) {
      setDocumentName(snap.path);
      setDocumentSource(snap.source);
      setSavedSource(snap.source);
    } else if (snap.source.trim().length > 0) {
      setDocumentName(snap.name || snap.path || "<editor>");
      setDocumentSource(snap.source);
      setSavedSource(snap.source);
    }
    if (snap.analysis) {
      setAnalysis(snap.analysis);
    }
    if (snap.treeOutline) {
      setTreeOutline(snap.treeOutline);
    }
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    workspaceRoots()
      .then((next) => {
        setShelf(next);
        return workspaceTree();
      })
      .then((next) => {
        setTree(next);
        setTreeOutline(outlineTree(next.entries));
      })
      .catch((reason: unknown) => setError(describeError(reason)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let alive = true;
    void Promise.all([kernelCatalogue(), sampleGenesis()])
      .then(([roots, genesis]) => {
        if (!alive) {
          return;
        }
        setCatalogue(roots);
        setSample(genesis);
      })
      .catch((reason: unknown) => {
        if (alive) {
          setError(describeError(reason));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void getEditorContext()
      .then(applySnapshot)
      .catch(() => undefined);
    void onEditorContext(applySnapshot).then((unlisten) => {
      stop = unlisten;
    });
    return () => {
      stop?.();
    };
  }, [applySnapshot]);

  useEffect(() => {
    if (!documentSource.trim()) {
      setAnalysis(null);
      return undefined;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void analyzeSource(documentSource)
        .then((next) => {
          if (alive) {
            setAnalysis(next);
          }
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [documentSource]);

  const context = useMemo(() => {
    const note = videoName
      ? `\n\n[video local «${videoName}»: previsualización en la ventana, sin enviar píxeles]`
      : "";
    return `${documentSource}${note}`;
  }, [documentSource, videoName]);

  function openEntry(entry: WorkspaceEntry) {
    if (!tree) {
      return;
    }
    if (entry.bara) {
      workspaceReadDocument(entry.path)
        .then((document) => {
          setDocumentName(document.path);
          setDocumentSource(document.source);
          setSavedSource(document.source);
          setError(null);
        })
        .catch((reason: unknown) => setError(describeError(reason)));
      return;
    }
    if (entry.kind === "file") {
      readProjectFile(entry.path)
        .then((document) => {
          setDocumentName(document.path);
          setDocumentSource(document.source);
          setSavedSource(document.source);
          setError(null);
        })
        .catch((reason: unknown) => setError(describeError(reason)));
    }
  }

  function attachText(file: File) {
    if (file.size > MAX_TEXT_BYTES) {
      setError("el fragmento supera 256 KB");
      return;
    }
    file
      .text()
      .then((text) => {
        setDocumentName(file.name);
        setDocumentSource(text);
        setSavedSource(text);
        setError(null);
      })
      .catch((reason: unknown) => setError(describeError(reason)));
  }

  const saveDocument = useCallback(() => {
    if (!dirty) {
      return;
    }
    setSaving(true);
    workspaceWriteDocument(documentName, documentSource)
      .then((document) => {
        setDocumentSource(document.source);
        setSavedSource(document.source);
        setError(null);
      })
      .catch((reason: unknown) => setError(describeError(reason)))
      .finally(() => setSaving(false));
  }, [dirty, documentName, documentSource]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveDocument();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveDocument]);

  return (
    <div className="desk-split">
      <aside className="workspace">
        <ul className="shelf">
          {(shelf?.roots ?? []).map((slot) => {
            const onlyRoot = (shelf?.roots.length ?? 0) <= 1;
            return (
              <li key={slot.id}>
                <button
                  type="button"
                  className={slot.active ? "shelf-active" : undefined}
                  onClick={() => {
                    workspaceActivate(slot.id)
                      .then(() => reload())
                      .catch((reason: unknown) => setError(describeError(reason)));
                  }}
                >
                  {slot.name}
                </button>
                <button
                  type="button"
                  className="shelf-close"
                  aria-label={
                    onlyRoot
                      ? `No se cierra la última carpeta (${slot.name})`
                      : `Cerrar ${slot.name}`
                  }
                  title={onlyRoot ? "La última carpeta del estante no se cierra" : "Cerrar carpeta"}
                  disabled={onlyRoot}
                  onClick={() => {
                    if (onlyRoot) {
                      return;
                    }
                    workspaceCloseRoot(slot.id)
                      .then((next) => {
                        setShelf(next);
                        reload();
                      })
                      .catch((reason: unknown) => setError(describeError(reason)));
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <div className="workspace-actions">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              workspaceOpenDialog()
                .then((next) => {
                  setTree(next);
                  setTreeOutline(outlineTree(next.entries));
                  setError(null);
                })
                .catch((reason: unknown) => {
                  const message = describeError(reason);
                  if (message !== "cancelado") {
                    setError(message);
                  }
                })
                .finally(() => setLoading(false));
            }}
          >
            Añadir carpeta
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="workspace-tree">
          {loading ? (
            <p className="muted">Enumerando…</p>
          ) : tree ? (
            <FileTree entries={tree.entries} activePath={null} onOpen={openEntry} />
          ) : (
            <p className="muted">Sin carpeta activa.</p>
          )}
        </div>
      </aside>
      <section className="desk-chat">
        <div className="desk-media">
          <div className="row">
            <span className="status" title={documentName}>
              {documentName}
              {dirty ? " · sin guardar" : documentName.endsWith(".bara") ? " · guardado" : ""}
            </span>
            <span className="grow" />
            <button type="button" disabled={!dirty || saving} onClick={saveDocument}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
          {documentName.endsWith(".bara") || documentSource.length > 0 ? (
            <textarea
              className="desk-source"
              value={documentSource}
              spellCheck={false}
              aria-label="Documento de contexto"
              onChange={(event) => setDocumentSource(event.target.value)}
            />
          ) : null}
          <label>
            Fragmento de código
            <input
              type="file"
              accept=".bara,.txt,.rs,.ts,.tsx,.md,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  attachText(file);
                }
                event.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              inspectMediaDialog()
                .then((inspection) => {
                  setVideoName(inspection.name);
                  setMediaNote(
                    `${inspection.kind} · ${inspection.bytes} bytes · el backend no entregó píxeles`,
                  );
                  setError(null);
                })
                .catch((reason: unknown) => {
                  const message = describeError(reason);
                  if (message !== "cancelado") {
                    setError(message);
                  }
                });
            }}
          >
            Inspeccionar imagen o video
          </button>
          <p className="muted">
            {mediaNote ?? "La cota de 32 MB la aplica el backend. Los píxeles no entran en el chat."}
          </p>
          <p className="muted">
            Catálogo: {catalogue.length} raíces
            {analysis ? ` · análisis ${analysis.summary.total} tokens` : ""}
          </p>
        </div>
        <ChatPanel
          open
          documentName={documentName}
          documentSource={context}
          analysis={analysis}
          catalogue={catalogue}
          sample={sample}
          treeOutline={treeOutline}
          onUseCode={(code) => {
            setDocumentName("<fragmento>");
            setDocumentSource(code);
          }}
          onJudge={async () => ({
            glyph: "⊥",
            status: "false",
            applied: false,
            path: "",
            line: 1,
            inserted: 0,
            source: "",
            verified: false,
            unverifiedReason: "",
            previewDiff: "",
            canApply: false,
            blockReason: "ventana auxiliar: sin escritura",
            backupPath: "",
          })}
          onConfirm={async () => ({
            glyph: "⊥",
            status: "false",
            applied: false,
            path: "",
            line: 1,
            inserted: 0,
            source: "",
            verified: false,
            unverifiedReason: "",
            previewDiff: "",
            canApply: false,
            blockReason: "ventana auxiliar: sin escritura",
            backupPath: "",
          })}
          onUndo={async () => ({
            glyph: "⊥",
            status: "false",
            applied: false,
            path: "",
            line: 1,
            inserted: 0,
            source: "",
            verified: false,
            unverifiedReason: "",
            previewDiff: "",
            canApply: false,
            blockReason: "ventana auxiliar: sin escritura",
            backupPath: "",
          })}
        />
      </section>
    </div>
  );
}

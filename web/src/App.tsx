import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CLASS_LABEL,
  analyzeFile,
  analyzeSource,
  belnapLattice,
  describeError,
  kernelCatalogue,
  oracleConverse,
  oracleReset,
  oracleStatus,
  readDocument,
  sampleGenesis,
  temporalRollback,
  type Analysis,
  type BelnapLattice,
  type RootEntry,
  type SessionStatus,
  type TokenInfo,
  type TurnView,
} from "./engine";
import ChatPanel from "./components/ChatPanel";

/** Máximo de filas de tokens que se pintan (rendimiento del WebView). */
const MAX_ROWS = 1200;

export default function App() {
  const [source, setSource] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [catalogue, setCatalogue] = useState<RootEntry[]>([]);
  const [path, setPath] = useState("samples/genesis.bara");
  const [origin, setOrigin] = useState("<editor>");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  /** Documento de ejemplo del kernel (contexto del asistente). */
  const [sample, setSample] = useState("");
  /** Visibilidad del panel lateral del asistente. */
  const [aiOpen, setAiOpen] = useState(false);
  /** Sesión del oráculo: estado que mide el kernel y último turno conversado. */
  const [oracle, setOracle] = useState<SessionStatus | null>(null);
  const [lastTurn, setLastTurn] = useState<TurnView | null>(null);
  /** Marcador temporal capturado para el `Δ⁻¹` manual. */
  const [marker, setMarker] = useState<number | null>(null);
  /** Biláttice de Belnap que sirve el kernel. */
  const [lattice, setLattice] = useState<BelnapLattice | null>(null);
  /** Consulta que se conversa con el oráculo (léxico del kernel). */
  const [query, setQuery] = useState("ברא");

  /** Invoca al backend del kernel y publica el resultado. */
  const runAnalysis = useCallback(async (text: string, from: string) => {
    setBusy(true);
    try {
      const result = await analyzeSource(text);
      setAnalysis(result);
      setOrigin(from);
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
        setSource(genesis);
        setOrigin("samples/genesis.bara");
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

  // Análisis en vivo con retardo: no se invoca al kernel en cada tecla.
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void runAnalysis(source, origin);
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready, source, origin, runAnalysis]);

  /** Abre el documento indicado en el editor (lectura hecha en Rust). */
  const openFile = useCallback(async () => {
    setBusy(true);
    try {
      const text = await readDocument(path);
      setSource(text);
      setOrigin(path);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [path]);

  /** Analiza la ruta directamente en el backend, sin cargarla en el editor. */
  const analyzePath = useCallback(async () => {
    setBusy(true);
    try {
      const result = await analyzeFile(path);
      setAnalysis(result);
      setOrigin(path);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [path]);

  /** Conversa un turno con el oráculo del kernel (`oracle_converse`). */
  const askOracle = useCallback(async () => {
    if (query.trim().length === 0) {
      return;
    }
    setBusy(true);
    try {
      const result = await oracleConverse(query);
      setLastTurn(result.turn);
      setOracle(result.status);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [query]);

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
  const applyCode = useCallback((code: string) => {
    setSource((previous) =>
      previous.trim().length === 0 ? code : `${previous.replace(/\s+$/, "")}\n\n${code}`,
    );
    setOrigin("<editor>");
  }, []);

  const rows = useMemo<TokenInfo[]>(
    () => (analysis ? analysis.tokens.slice(0, MAX_ROWS) : []),
    [analysis],
  );

  return (
    <div className={aiOpen ? "app ai-open" : "app"}>
      <header className="bar">
        <h1>Bara IDE</h1>
        <span className="tag">kernel v0.1.0-kernel · Shoresh</span>
        <span className="grow" />
        <span className="status">{busy ? "analizando…" : origin}</span>
        <button type="button" onClick={() => setAiOpen(!aiOpen)}>
          {aiOpen ? "ocultar asistente" : "asistente"}
        </button>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <main className="grid">
        <section className="pane">
          <div className="row">
            <input
              className="path"
              value={path}
              spellCheck={false}
              placeholder="ruta/al/documento.bara"
              onChange={(event) => {
                setPath(event.target.value);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void openFile();
              }}
            >
              Abrir
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void analyzePath();
              }}
            >
              Analizar ruta
            </button>
          </div>
          <textarea
            className="code"
            dir="auto"
            spellCheck={false}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setOrigin("<editor>");
            }}
          />
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

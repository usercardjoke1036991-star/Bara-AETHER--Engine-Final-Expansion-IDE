// Panel del **constructor visual**: el lienzo JSON se vuelve Shoresh firmado.
//
// Todo lo que se pinta lo decidió el kernel (`visual_builder` de `bara`, a
// través del módulo `visual` de `bara-ide`): la validación estricta de todo o
// nada, la traducción a AST, el reparto áureo de la retícula, el informe de
// riesgo y la firma del ADN. La interfaz sólo edita el texto, pide y formatea.

import { useCallback, useEffect, useState } from "react";

import { describeError } from "../engine";
import {
  MAX_COMPOSED_CANVASES,
  visualBuild,
  visualCatalogue,
  visualCompose,
  visualEmit,
  visualEmitComposed,
  visualSample,
  type VisualBlockView,
  type VisualBuildView,
  type VisualCatalogueView,
  type VisualCellView,
} from "../visual";

/** Decimales con los que se publican las métricas fraccionarias del núcleo. */
function fixed(value: number, digits = 3): string {
  return value.toFixed(digits);
}

/** Marca de un veredicto booleano del núcleo. */
function mark(value: boolean): string {
  return value ? "✓" : "✗";
}

/** Un bloque colocado en el disco del lienzo, en porcentaje. */
interface Placed {
  block: VisualBlockView;
  left: string;
  top: string;
}

/**
 * Coloca los bloques en el disco del lienzo.
 *
 * Las coordenadas **son** las de la espiral áurea del kernel
 * (`visual_builder::layout`, `r_k = √k`, `θ_k = k·2π/φ²`); aquí sólo se
 * normalizan a porcentajes del ancho visible. Los bloques sin celda (sólo
 * posibles ante una incoherencia interna) no se colocan.
 */
function place(blocks: VisualBlockView[]): Placed[] {
  const located = blocks
    .map((block) => ({ block, cell: block.cell }))
    .filter((entry): entry is { block: VisualBlockView; cell: VisualCellView } => entry.cell !== null);
  if (located.length === 0) {
    return [];
  }
  const xs = located.map((entry) => entry.cell.x);
  const ys = located.map((entry) => entry.cell.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  return located.map((entry) => ({
    block: entry.block,
    left: `${(6 + ((entry.cell.x - minX) / spanX) * 88).toFixed(2)}%`,
    top: `${(6 + ((entry.cell.y - minY) / spanY) * 88).toFixed(2)}%`,
  }));
}

/** Panel del constructor visual: edita el lienzo y muestra su traducción firmada. */
export default function VisualBuilder({
  open,
  onUseCode,
}: {
  /** Visibilidad del panel (lo gobierna el encabezado del IDE). */
  open: boolean;
  /**
   * Lleva al editor sólo el programa que `visual_emit` acaba de firmar.
   * El texto cacheado del panel no basta: el kernel vuelve a verificar el sello.
   */
  onUseCode: (code: string) => void;
}) {
  /** Texto del lienzo en edición. */
  const [blueprint, setBlueprint] = useState("");
  /** Contrato del lienzo (clases, tipos y cotas), servido por el kernel. */
  const [catalogue, setCatalogue] = useState<VisualCatalogueView | null>(null);
  /** Última traducción firmada del kernel. */
  const [view, setView] = useState<VisualBuildView | null>(null);
  /** Lienzos encolados para componer (el orden es significativo). */
  const [drafts, setDrafts] = useState<string[]>([]);
  /** Origen del resultado mostrado (`lienzo` o `compuesto`). */
  const [scope, setScope] = useState("lienzo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  /** Bloque del lienzo cuya fila del AST está seleccionada. */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Arranque perezoso: el contrato y el ejemplo los sirve Rust, no TypeScript.
  useEffect(() => {
    if (!open || ready) {
      return undefined;
    }
    let alive = true;
    void (async () => {
      try {
        const [catalog, sample] = await Promise.all([visualCatalogue(), visualSample()]);
        if (!alive) {
          return;
        }
        setCatalogue(catalog);
        // El lienzo del usuario manda: sólo se siembra si está vacío.
        setBlueprint((previous) => (previous.trim().length === 0 ? sample : previous));
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
  }, [open, ready]);

  /** Traduce, valida y firma un lienzo con el motor del kernel. */
  const translate = useCallback(async (text: string, origin: string) => {
    setBusy(true);
    try {
      const result = await visualBuild(text);
      setView(result);
      setScope(origin);
      setError(null);
    } catch (failure) {
      setView(null);
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  // Traducción en vivo con retardo: no se invoca al kernel en cada tecla.
  useEffect(() => {
    if (!open || blueprint.trim().length === 0) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void translate(blueprint, "lienzo");
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, blueprint, translate]);

  /** Compone los lienzos encolados en un único ADN firmado. */
  const compose = useCallback(async () => {
    setBusy(true);
    try {
      const result = await visualCompose(drafts);
      setView(result);
      setScope(`compuesto · ${drafts.length} lienzo(s)`);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [drafts]);

  /** Encola el lienzo en edición (cota del panel, no del kernel). */
  const addDraft = useCallback(() => {
    if (blueprint.trim().length === 0) {
      return;
    }
    setDrafts((previous) =>
      previous.length >= MAX_COMPOSED_CANVASES ? previous : [...previous, blueprint],
    );
  }, [blueprint]);

  /** Quita un lienzo de la composición por su posición. */
  const dropDraft = useCallback((index: number) => {
    setDrafts((previous) => previous.filter((_, position) => position !== index));
  }, []);

  /**
   * Emite el `.bara` sólo después de que Rust vuelva a verificar el sello.
   * `compuesto` usa la cola; el lienzo suelto usa el texto en edición.
   *
   * Los hooks van antes del `return` de panel cerrado: si no, abrir el lienzo
   * cambia el número de hooks y React desmonta toda la aplicación.
   */
  const emitToEditor = useCallback(async () => {
    setBusy(true);
    try {
      const emission =
        scope.startsWith("compuesto") && drafts.length > 0
          ? await visualEmitComposed(drafts)
          : await visualEmit(blueprint);
      onUseCode(emission.source);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [blueprint, drafts, onUseCode, scope]);

  /** Recupera el lienzo de ejemplo del kernel (el que el IDE ofrece al abrir). */
  const useExample = useCallback(() => {
    void visualSample()
      .then((text) => {
        setBlueprint(text);
      })
      .catch((failure: unknown) => {
        setError(describeError(failure));
      });
  }, []);

  if (!open) {
    return null;
  }

  const placed = view ? place(view.blocks) : [];

  return (
    <section className="pane vb">
      <div className="row">
        <h2>Constructor visual · lienzo → Shoresh firmado</h2>
        <span className="grow" />
        <span className="status">
          {busy ? "traduciendo…" : view ? `${scope} · ${view.label}` : "sin lienzo válido"}
        </span>
        <button
          type="button"
          disabled={busy || blueprint.trim().length === 0}
          onClick={() => {
            void translate(blueprint, "lienzo");
          }}
        >
          Traducir y firmar
        </button>
        <button type="button" disabled={busy || blueprint.trim().length === 0} onClick={addDraft}>
          Añadir al compuesto
        </button>
        <button
          type="button"
          disabled={busy || drafts.length === 0}
          onClick={() => {
            void compose();
          }}
        >
          Componer ({drafts.length})
        </button>
        <button type="button" disabled={busy || drafts.length === 0} onClick={() => setDrafts([])}>
          Limpiar compuesto
        </button>
        <button type="button" disabled={busy} onClick={useExample}>
          Ejemplo
        </button>
      </div>

      {error ? <p className="ai-error">{error}</p> : null}

      <div className="vb-split">
        <label className="vb-field">
          <span>
            lienzo JSON estricto: el kernel rechaza claves desconocidas, tipos fuera del catálogo,
            aridad que no cuadra y referencias hacia delante
          </span>
          <textarea
            className="code"
            dir="ltr"
            spellCheck={false}
            value={blueprint}
            onChange={(event) => {
              setBlueprint(event.target.value);
            }}
          />
        </label>

        <div className="vb-canvas" role="img" aria-label="retícula áurea del lienzo">
          {placed.length === 0 ? (
            <p className="muted">Sin retícula: el kernel no publicó celdas para este lienzo.</p>
          ) : (
            placed.map((entry, index) => (
              <button
                type="button"
                key={`${index}:${entry.block.id}`}
                className={`vb-node vb-${entry.block.kind}${
                  selectedId === entry.block.id ? " selected" : ""
                }`}
                style={{ left: entry.left, top: entry.top }}
                title={`${entry.block.name} · ${entry.block.root} · riesgo ${fixed(
                  entry.block.hazard,
                )}`}
                onClick={() => setSelectedId(entry.block.id)}
              >
                <strong>{entry.block.id}</strong>
                <small>{entry.block.kindLabel}</small>
                {entry.block.sanitized ? <em title="nace sellado bajo guarda שמר">שמר</em> : null}
              </button>
            ))
          )}
        </div>
      </div>

      {view ? (
        <>
          <div className="row">
            <button
              type="button"
              disabled={busy || !view.report.verified}
              onClick={() => {
                void emitToEditor();
              }}
            >
              Emitir .bara firmado
            </button>
            <span className={view.report.verified ? "kx-tag kx-ok" : "kx-tag kx-warn"}>
              ADN {mark(view.report.verified)} · clave 0x{view.report.keyId.toString(16)}
            </span>
            <span className="kx-tag">{view.label}</span>
            <span className="kx-tag">{scope}</span>
          </div>

          <p className={view.report.verified ? "kx-ok" : "kx-warn"}>{view.report.verdict}</p>

          <div className="vb-cards">
            <article className="kx-card">
              <h3>Informe del kernel</h3>
              <table className="summary">
                <tbody>
                  <tr>
                    <th>bloques · aristas</th>
                    <td className="num">
                      {view.report.blocks} · {view.report.edges}
                    </td>
                  </tr>
                  <tr>
                    <th>profundidad</th>
                    <td className="num">{view.report.depth}</td>
                  </tr>
                  <tr>
                    <th>riesgo medio</th>
                    <td className="num">{fixed(view.report.hazardMean)}</td>
                  </tr>
                  <tr>
                    <th>riesgo máximo</th>
                    <td className="num">{fixed(view.report.hazardMax)}</td>
                  </tr>
                  <tr>
                    <th>cota áurea</th>
                    <td className="num">{fixed(view.report.hazardBound)}</td>
                  </tr>
                  <tr>
                    <th>sellados</th>
                    <td className="num">{view.report.sealed}</td>
                  </tr>
                  <tr>
                    <th>retícula</th>
                    <td className="num">
                      radio {fixed(view.report.radius)} · mín {fixed(view.report.minDistance)}
                    </td>
                  </tr>
                  <tr>
                    <th>orden topológico</th>
                    <td className="num">{view.report.order.join(" → ")}</td>
                  </tr>
                </tbody>
              </table>

              <ul className="kx-checks">
                {view.report.checks.map((check) => (
                  <li key={check.name} className={check.passed ? "kx-ok" : "kx-warn"}>
                    {mark(check.passed)} {check.name}
                  </li>
                ))}
              </ul>

              <details className="kx-detail">
                <summary>sello del ADN</summary>
                <p className="kx-mono">raíz {view.report.rootHex}</p>
                <p className="kx-mono">firma {view.report.signatureHex}</p>
              </details>
            </article>

            <article className="kx-card">
              <h3>Bloques del lienzo</h3>
              <ul className="kx-list">
                {view.blocks.map((block, index) => (
                  <li key={`${index}:${block.id}`}>
                    <strong>{block.id}</strong> · {block.kindLabel} · aridad {block.arity} ·{" "}
                    {block.retGlyph} {block.retLabel} · riesgo {fixed(block.hazard)}{" "}
                    {block.sanitized ? <span className="kx-tag">sellado</span> : null}
                    {block.valence ? (
                      <span className="kx-tag" title="valencia paraconsistente del kernel">
                        {block.valence.observation.glyph}
                      </span>
                    ) : null}
                    <br />
                    <span className="kx-mono">{block.root}</span>
                    {block.inputs.length > 0 ? (
                      <span className="muted">
                        {" ← "}
                        {block.inputs
                          .map((slot) => `${slot.index}:${slot.typeName}`)
                          .join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </article>

            <article className="kx-card">
              <h3>AST *Shoresh* ({view.ast.length} nodo(s))</h3>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>raíz</th>
                      <th>original</th>
                      <th>aridad</th>
                      <th>retorno</th>
                      <th>riesgo</th>
                      <th>⊤/⊥</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.ast.map((node, index) => (
                      <tr
                        key={`${index}:${node.root}`}
                        className={
                          selectedId !== null && view.blocks[index]?.id === selectedId
                            ? "vb-selected"
                            : undefined
                        }
                      >
                        <td className="lexeme">{node.root}</td>
                        <td>{node.original}</td>
                        <td className="num">{node.arity}</td>
                        <td className="num">
                          {node.retGlyph} {node.retLabel}
                        </td>
                        <td className="num">{fixed(node.hazard)}</td>
                        <td className="num">
                          {node.valence.observation.glyph}
                          {node.sanitized ? " שמר" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="kx-detail">
                <summary>programa Shoresh traducido</summary>
                <pre className="kx-mono">{view.source}</pre>
              </details>
            </article>

            <article className="kx-card">
              <h3>
                Composición ({drafts.length}/{MAX_COMPOSED_CANVASES})
              </h3>
              {drafts.length === 0 ? (
                <p className="muted">
                  Sin lienzos encolados: «Añadir al compuesto» encola el lienzo en edición.
                </p>
              ) : (
                <ul className="kx-list">
                  {drafts.map((draft, index) => (
                    <li key={`${index}:${draft.length}`}>
                      <span className="kx-mono">#{index}</span> · {draft.length} caracteres ·{" "}
                      <button type="button" onClick={() => dropDraft(index)}>
                        quitar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted">
                El orden importa: la etiqueta firmada es la del primer lienzo con el sufijo
                «:compuesto» y la raíz de Merkle depende de la secuencia de nodos.
              </p>
            </article>

            <article className="kx-card">
              <h3>Contrato del lienzo</h3>
              {catalogue ? (
                <>
                  <ul className="kx-chips">
                    {catalogue.types.map((tipo) => (
                      <li
                        key={tipo.name}
                        className="kx-chip"
                        title={`${tipo.name} · nombre hebreo ${tipo.label}`}
                      >
                        {tipo.glyph} {tipo.name}
                      </li>
                    ))}
                  </ul>
                  <ul className="kx-chips">
                    {catalogue.kinds.map((clase) => (
                      <li
                        key={clase.name}
                        className="kx-chip"
                        title={clase.forcesSeal ? "fuerza sellado שמר" : "no fuerza sellado"}
                      >
                        {clase.name} · {clase.label}
                        {clase.forcesSeal ? " 🔒" : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="muted">
                    ≤ {catalogue.limits.maxBlocks} bloques · ≤ {catalogue.limits.maxBlueprintBytes}{" "}
                    B · profundidad JSON ≤ {catalogue.limits.maxJsonDepth} · id ≤{" "}
                    {catalogue.limits.maxIdChars} · nace sellado desde{" "}
                    {fixed(catalogue.limits.sealThreshold)} · celda ≥{" "}
                    {fixed(catalogue.limits.minCellDistance)}
                  </p>
                </>
              ) : (
                <p className="muted">Contrato no disponible.</p>
              )}
            </article>
          </div>
        </>
      ) : (
        <p className="muted">
          Sin traducción: el kernel sólo publica un AST cuando el lienzo respeta su contrato entero.
        </p>
      )}
    </section>
  );
}


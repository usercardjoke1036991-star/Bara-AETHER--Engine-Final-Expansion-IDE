// Tarjetas del **Cockpit de telemetría**: censo de Belnap, transmutador,
// inspector *Shoresh* y caja negra.
//
// Igual que las tarjetas de AETHER-Ω, son sólo presentación: reciben las
// proyecciones que el kernel ya decidió y las formatean. Los recortes de filas
// y de texto existen para no ahogar el WebView; los datos completos siguen en
// el backend y se muestran bajo demanda.

import type {
  BelnapCensus,
  FlightLog,
  NeuralFrame,
  SystemManifest,
  TransmutationResult,
} from "../telemetry";

/** Máximo de nodos del AST que se listan (el informe completo sigue en Rust). */
const MAX_AST_ROWS = 32;

/** Máximo de entradas de la caja negra que se listan. */
const MAX_LOG_ROWS = 20;

/** Máximo de caracteres del volcado textual de la caja negra. */
const MAX_LOG_TEXT = 8000;

/** Marca de un veredicto booleano del núcleo. */
function mark(value: boolean): string {
  return value ? "✓" : "✗";
}

/** Sí/no explícito para banderas donde ✓/✗ se leería como «correcto». */
function yesNo(value: boolean): string {
  return value ? "sí" : "no";
}

/** Suma canónica de un censo tetravalente. */
function censusTotal(census: BelnapCensus): number {
  return census.verdadero + census.falso + census.contradictorio + census.indeterminado;
}

/** Porcentaje legible de una parte sobre el total del censo. */
function percent(value: number, total: number): string {
  return total === 0 ? "0 %" : `${((value / total) * 100).toFixed(1)} %`;
}

/** Recorta una huella larga para las tablas; el valor completo va en `title`. */
function shortHash(value: string, length = 16): string {
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

/** Los cuatro valores del biláttice en el orden canónico `⊤ ⊥ ⊤∧⊥ ∅`. */
export function CensusTiles({ census }: { census: BelnapCensus }) {
  const total = censusTotal(census);
  const rows = [
    { glyph: "⊤", label: "verdadero", value: census.verdadero, tone: "ck-true" },
    { glyph: "⊥", label: "falso", value: census.falso, tone: "ck-false" },
    { glyph: "⊤∧⊥", label: "contradictorio", value: census.contradictorio, tone: "ck-both" },
    { glyph: "∅", label: "indeterminado", value: census.indeterminado, tone: "ck-none" },
  ];
  return (
    <div className="ck-census">
      {rows.map((row) => (
        <div className={`ck-cell ${row.tone}`} key={row.label}>
          <span className="ck-glyph">{row.glyph}</span>
          <span className="ck-count">{row.value}</span>
          <span className="ck-label">{row.label}</span>
          <span className="ck-bar">
            <span style={{ width: percent(row.value, total) }} />
          </span>
          <span className="ck-pct">{percent(row.value, total)}</span>
        </div>
      ))}
    </div>
  );
}

/** Censo de la inferencia y de la memoria a largo plazo. */
export function CensoCard({ frame }: { frame: NeuralFrame }) {
  const memory = frame.memoria;
  return (
    <article className="kx-card ck-card">
      <h3>Censo tetravalente · inferencia</h3>
      <p className={frame.coherente ? "kx-ok" : "kx-warn"}>
        generación {frame.generacion} · {frame.inferencia.nodos} nodo(s) ·{" "}
        {mark(frame.coherente)} coherente
      </p>
      <CensusTiles census={frame.censo} />
      <table className="summary">
        <tbody>
          <tr>
            <th>reglas</th>
            <td className="num">{frame.inferencia.reglas}</td>
          </tr>
          <tr>
            <th>aplicadas · cambiadas</th>
            <td className="num">
              {frame.inferencia.aplicadas} · {frame.inferencia.cambiadas}
            </td>
          </tr>
          <tr>
            <th>derivadas · capas</th>
            <td className="num">
              {frame.inferencia.derivadas} · {frame.inferencia.capas}
            </td>
          </tr>
          <tr>
            <th>truncado</th>
            <td className="num">{yesNo(frame.inferencia.truncado)}</td>
          </tr>
        </tbody>
      </table>

      <div className="ck-divider" />
      <h4 className="ck-subhead">Memoria a largo plazo</h4>
      {memory ? (
        <>
          <table className="summary">
            <tbody>
              <tr>
                <th>entradas · capacidad</th>
                <td className="num">
                  {memory.entradas} / {memory.capacidad} {memory.llena ? "· llena" : ""}
                </td>
              </tr>
              <tr>
                <th>escrituras · riesgo</th>
                <td className="num">
                  {memory.escrituras} · {memory.riesgo}
                </td>
              </tr>
              <tr>
                <th>huella</th>
                <td className="ck-mono ck-break" title={memory.huella}>
                  {shortHash(memory.huella)}
                </td>
              </tr>
            </tbody>
          </table>
          <CensusTiles census={memory.censo} />
        </>
      ) : (
        <p className="muted">El kernel no publicó memoria para este marco.</p>
      )}
    </article>
  );
}

/** Inspector del índice semántico *Shoresh* y del manifiesto del puente. */
export function ShoreshCard({
  frame,
  manifest,
}: {
  frame: NeuralFrame;
  manifest: SystemManifest;
}) {
  const semantic = frame.semantica;
  return (
    <article className="kx-card ck-card">
      <h3>Inspector Shoresh · índice semántico</h3>
      {semantic ? (
        <>
          <p className={semantic.contradicciones === 0 ? "kx-ok" : "kx-warn"}>
            {semantic.nodos} nodo(s) en {semantic.ranuras}/{semantic.capacidad} ranura(s) ·{" "}
            {semantic.contradicciones} contradicción(es) · {semantic.indeterminados}{" "}
            indeterminado(s)
          </p>
          <CensusTiles census={semantic.censo} />
          <table className="summary">
            <tbody>
              <tr>
                <th>huella</th>
                <td className="ck-mono ck-break" title={semantic.huella}>
                  {shortHash(semantic.huella)}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">El kernel no publicó índice semántico para este marco.</p>
      )}

      <div className="ck-divider" />
      <h4 className="ck-subhead">Manifiesto del puente</h4>
      <p className="muted ck-break">
        {manifest.esquema} · v{manifest.version} · {manifest.dominio}
      </p>
      <table className="summary">
        <tbody>
          <tr>
            <th>huella de identidad</th>
            <td className="ck-mono ck-break" title={manifest.huella_identidad}>
              {shortHash(manifest.huella_identidad, 24)}
            </td>
          </tr>
          <tr>
            <th>huella del manifiesto</th>
            <td className="ck-mono ck-break" title={manifest.huella_manifiesto}>
              {shortHash(manifest.huella_manifiesto, 24)}
            </td>
          </tr>
          <tr>
            <th>demo canónico</th>
            <td className="num">{manifest.demo.length} caracteres</td>
          </tr>
        </tbody>
      </table>

      {manifest.secciones.length > 0 ? (
        <div className="scroll ck-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Sección</th>
                <th>Origen</th>
                <th>Cota</th>
              </tr>
            </thead>
            <tbody>
              {manifest.secciones.map((section) => (
                <tr key={section.nombre}>
                  <td className="ck-glyph">{section.glifo}</td>
                  <td>{section.nombre}</td>
                  <td className="muted">{section.origen}</td>
                  <td className="num">{section.cota_bytes} B</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">El manifiesto no declaró secciones.</p>
      )}
    </article>
  );
}
/** Consola del transmutador: edita la fuente y muestra el dictamen del kernel. */
export function TransmuterCard({
  entry,
  outcome,
  busy,
  onEntry,
  onRun,
  onDocument,
  onDemo,
}: {
  entry: string;
  outcome: TransmutationResult | null;
  busy: boolean;
  onEntry: (value: string) => void;
  onRun: () => void;
  onDocument: () => void;
  onDemo: () => void;
}) {
  const report = outcome?.informe ?? null;
  return (
    <article className="kx-card ck-card ck-wide">
      <h3>Transmutador · fuente externa → AST Shoresh</h3>
      <p className="muted">
        El kernel detecta el lenguaje, audita las sentencias y sólo indexa el AST si el
        dictamen es admisible. Nada se interpreta en TypeScript.
      </p>
      <textarea
        className="code ck-code"
        dir="ltr"
        spellCheck={false}
        value={entry}
        onChange={(event) => {
          onEntry(event.target.value);
        }}
      />
      <div className="row ck-actions">
        <button type="button" disabled={busy} onClick={onDocument}>
          documento del editor
        </button>
        <button type="button" disabled={busy} onClick={onDemo}>
          demo del kernel
        </button>
        <button type="button" className="ck-primary" disabled={busy} onClick={onRun}>
          {busy ? "transmutando…" : "transmutar"}
        </button>
      </div>

      {outcome ? (
        <>
          <p className={outcome.admisible ? "kx-ok" : "kx-warn"}>
            {outcome.admisible
              ? `Admitida · ${outcome.lenguaje.nombre} (${outcome.lenguaje.tag}) · ${outcome.ast.length} nodo(s)`
              : `Rechazada · ${outcome.motivo ?? "motivo no publicado"}`}
          </p>
          {report ? (
            <table className="summary">
              <tbody>
                <tr>
                  <th>sentencias</th>
                  <td className="num">{report.sentencias}</td>
                </tr>
                <tr>
                  <th>aceptadas · rechazadas</th>
                  <td className="num">
                    {report.aceptadas} · {report.rechazadas}
                  </td>
                </tr>
                <tr>
                  <th>cuarentena</th>
                  <td className="num">{report.cuarentena}</td>
                </tr>
                <tr>
                  <th>⊤ · ⊥ · ⊤∧⊥ · ∅</th>
                  <td className="num">
                    {report.verdadero} · {report.falso} · {report.ambos} · {report.ninguno}
                  </td>
                </tr>
                <tr>
                  <th>sellados</th>
                  <td className="num">{report.sellados}</td>
                </tr>
                <tr>
                  <th>auditoría</th>
                  <td className={report.auditoria_ok ? "num kx-ok" : "num kx-warn"}>
                    {report.reglas_superadas}/{report.reglas_totales} {mark(report.auditoria_ok)}
                  </td>
                </tr>
                <tr>
                  <th>truncado · lossy</th>
                  <td className="num">
                    {yesNo(report.truncado)} · {yesNo(report.lossy)}
                  </td>
                </tr>
                <tr>
                  <th>memoria</th>
                  <td className="num">
                    {outcome.memoria.ingeridas} ingerida(s) · {outcome.memoria.omitidas} omitida(s)
                  </td>
                </tr>
              </tbody>
            </table>
          ) : null}

          {outcome.ast.length > 0 ? (
            <div className="scroll ck-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Raíz</th>
                    <th>Tipo</th>
                    <th>Ari</th>
                    <th>Riesgo</th>
                    <th>Valencia</th>
                    <th>Sello</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.ast.slice(0, MAX_AST_ROWS).map((node, index) => (
                    <tr key={`${index}:${node.raiz}`}>
                      <td className="ck-mono" title={node.original}>
                        {node.raiz}
                      </td>
                      <td title={node.tipo}>
                        {node.tipo_glifo} {node.tipo}
                      </td>
                      <td className="num">{node.aridad}</td>
                      <td className="num">{node.riesgo}</td>
                      <td title={node.valencia_nombre}>
                        {node.valencia} {node.valencia_nombre}
                      </td>
                      <td className="num">{mark(node.sellado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {outcome.ast.length > MAX_AST_ROWS ? (
            <p className="muted">
              Se muestran los primeros {MAX_AST_ROWS} de {outcome.ast.length} nodos.
            </p>
          ) : null}

          {outcome.sincronizacion ? (
            <div className="kx-sub">
              <h4>Sincronización Shoresh</h4>
              <p
                className={
                  outcome.sincronizacion.coherente && outcome.sincronizacion.auditoria.conforme
                    ? "kx-ok"
                    : "kx-warn"
                }
              >
                {outcome.sincronizacion.proposito} ·{" "}
                {mark(
                  outcome.sincronizacion.coherente && outcome.sincronizacion.auditoria.conforme,
                )}{" "}
                coherente
              </p>
              <table className="summary">
                <tbody>
                  <tr>
                    <th>índice</th>
                    <td className="num">
                      {outcome.sincronizacion.indice.nodos} nodo(s) ·{" "}
                      {outcome.sincronizacion.indice.indexadas} indexada(s) ·{" "}
                      {outcome.sincronizacion.indice.fusionadas} fusionada(s)
                    </td>
                  </tr>
                  <tr>
                    <th>ranuras</th>
                    <td className="num">
                      {outcome.sincronizacion.indice.ranuras}/
                      {outcome.sincronizacion.indice.capacidad}
                    </td>
                  </tr>
                  <tr>
                    <th>auditoría</th>
                    <td className="num">
                      {outcome.sincronizacion.auditoria.superadas}/
                      {outcome.sincronizacion.auditoria.totales}{" "}
                      {mark(outcome.sincronizacion.auditoria.conforme)}
                    </td>
                  </tr>
                  <tr>
                    <th>⊤∧⊥ · ∅</th>
                    <td className="num">
                      {outcome.sincronizacion.contradicciones} ·{" "}
                      {outcome.sincronizacion.indeterminados}
                    </td>
                  </tr>
                  <tr>
                    <th>huella</th>
                    <td
                      className="ck-mono ck-break"
                      title={outcome.sincronizacion.indice.huella}
                    >
                      {shortHash(outcome.sincronizacion.indice.huella)}
                    </td>
                  </tr>
                  <tr>
                    <th>billete</th>
                    <td className="ck-mono ck-break" title={outcome.sincronizacion.billete}>
                      {shortHash(outcome.sincronizacion.billete, 24)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <p className="muted">Sin dictamen todavía: pulsa «transmutar».</p>
      )}
    </article>
  );
}

/** Caja negra del kernel: contadores, últimas entradas y volcado textual. */
export function RecorderCard({ logs }: { logs: FlightLog }) {
  const counters = logs.contadores;
  return (
    <article className="kx-card ck-card">
      <h3>Caja negra · Flight Recorder</h3>
      <p className={counters.llena ? "kx-warn" : "kx-ok"}>
        {counters.ocupadas}/{counters.capacidad} entrada(s) · {counters.publicadas}{" "}
        publicada(s) · {mark(!counters.llena)} con holgura
      </p>
      <table className="summary">
        <tbody>
          <tr>
            <th>reservadas · en vuelo</th>
            <td className="num">
              {counters.reservadas} · {counters.en_vuelo}
            </td>
          </tr>
          <tr>
            <th>sobrescritas</th>
            <td className="num">{counters.sobrescritas}</td>
          </tr>
          <tr>
            <th>omitidas</th>
            <td className={logs.omitidas > 0 ? "num kx-warn" : "num"}>{logs.omitidas}</td>
          </tr>
        </tbody>
      </table>

      {logs.entradas.length > 0 ? (
        <div className="scroll ck-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Clase</th>
                <th>Violación</th>
                <th>Huella</th>
                <th>Conflicto</th>
              </tr>
            </thead>
            <tbody>
              {logs.entradas.slice(-MAX_LOG_ROWS).map((entry) => (
                <tr
                  key={entry.secuencia}
                  title={`clase ${entry.codigo_clase} · violación ${entry.codigo_violacion} · marca ${entry.marca}`}
                >
                  <td className="num">{entry.secuencia}</td>
                  <td>
                    <span className="ck-glyph">{entry.glifo}</span> {entry.clase}
                  </td>
                  <td>{entry.violacion}</td>
                  <td className="ck-mono" title={entry.huella}>
                    {shortHash(entry.huella, 12)}
                  </td>
                  <td className="num">{entry.conflicto ? "sí" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">La caja negra está vacía: el kernel no ha registrado eventos.</p>
      )}
      {logs.entradas.length > MAX_LOG_ROWS ? (
        <p className="muted">
          Se muestran las últimas {MAX_LOG_ROWS} de {logs.entradas.length} entradas.
        </p>
      ) : null}

      <details className="ai-report">
        <summary>volcado textual · {logs.texto.length} caracteres</summary>
        <pre className="kx-mono ck-scroll">{logs.texto.slice(0, MAX_LOG_TEXT)}</pre>
        {logs.texto.length > MAX_LOG_TEXT ? (
          <p className="muted">
            Volcado recortado a {MAX_LOG_TEXT} caracteres para el WebView.
          </p>
        ) : null}
      </details>
    </article>
  );
}


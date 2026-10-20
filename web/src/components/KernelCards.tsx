// Tarjetas del panel AETHER-Ω: una por fase del núcleo.
//
// Cada tarjeta es **sólo presentación**: recibe la proyección que el kernel ya
// decidió (`aether` de `bara-ide`) y la formatea. Los recortes de filas y de
// amplitudes existen para no ahogar el WebView y el núcleo los documenta en sus
// propias cotas (`MAX_INSTRUCTIONS`, `MAX_WORDS`, `truncated`…).

import {
  MAX_PANEL_PEERS,
  MAX_PANEL_ROUNDS,
  type AutopoiesisReport,
  type FractalMemoryView,
  type MeshView,
  type MetalView,
  type QuantumView,
  type TimelineView,
} from "../aether";
import {
  bridgeWarnings,
  type BridgeManifest,
  type BridgeSnapshot,
} from "../bridge";

/** Máximo de filas que se pintan por vector del kernel (rendimiento del WebView). */
export const MAX_ROWS = 24;

/** Máximo de amplitudes que se listan por qubit o enlace. */
const MAX_AMPLITUDES = 4;

/** Decimales con los que se publican las métricas fraccionarias del núcleo. */
function fixed(value: number, digits = 3): string {
  return value.toFixed(digits);
}

/** Porcentaje legible de una razón en `[0,1]`. */
function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)} %`;
}

/** Tamaño legible de un recuento de bytes. */
function bytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

/** Marca de un veredicto booleano del núcleo. */
function mark(value: boolean): string {
  return value ? "✓" : "✗";
}

/** Fase 1 — autopoiesis, valencia de Belnap y puerta ZK del documento. */
export function AutopoiesisCard({ report }: { report: AutopoiesisReport }) {
  return (
    <article className="kx-card">
      <h3>Fase 1 · autopoiesis ⊤∧⊥ y puerta ZK</h3>
      <p className={report.certified ? "kx-ok" : "kx-warn"}>{report.verdict}</p>
      <table className="summary">
        <tbody>
          <tr>
            <th>raíces del documento</th>
            <td className="num">{report.roots}</td>
          </tr>
          <tr>
            <th>generación evolutiva</th>
            <td className="num">{report.generation}</td>
          </tr>
          <tr>
            <th>axiomas vivos</th>
            <td className="num">{report.axioms.length}</td>
          </tr>
          <tr>
            <th>contradicciones toleradas</th>
            <td className="num">{report.contradictions}</td>
          </tr>
          <tr>
            <th>invariantes de la puerta</th>
            <td className="num">{report.gate.constraints}</td>
          </tr>
          <tr>
            <th>compromisos (A B C H)</th>
            <td className="num">{report.gate.commitments}</td>
          </tr>
          <tr>
            <th>entradas públicas</th>
            <td className="num">{report.gate.publicInputs}</td>
          </tr>
          <tr>
            <th>desafío Fiat–Shamir</th>
            <td className="num">{report.gate.challenge}</td>
          </tr>
        </tbody>
      </table>

      {report.unknownRoots.length > 0 ? (
        <ul className="kx-chips">
          {report.unknownRoots.map((root) => (
            <li key={root} className="kx-chip">
              {root}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Sin raíces desconocidas: no hubo axiogénesis.</p>
      )}

      {report.axioms.length > 0 ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Raíz</th>
                <th>Gen</th>
                <th>Valencia</th>
                <th>⊤∧⊥</th>
                <th>Regla del mutador</th>
              </tr>
            </thead>
            <tbody>
              {report.axioms.slice(0, MAX_ROWS).map((axiom) => (
                <tr key={`${axiom.root}:${axiom.generation}:${axiom.rule}`}>
                  <td className="glyph">{axiom.root}</td>
                  <td className="num">{axiom.generation}</td>
                  <td>
                    {axiom.valence.observation.glyph} {axiom.valence.key}
                  </td>
                  <td>{axiom.tolerated ? "retenida" : "—"}</td>
                  <td className="muted">{axiom.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="muted">
        Puerta: {report.gate.label} · {report.gate.summary}
      </p>
      <ul className="kx-checks">
        {report.gate.checks.map((check) => (
          <li key={check.name} className={check.passed ? "kx-ok" : "kx-warn"}>
            {mark(check.passed)} {check.name}
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Fila de métrica: rótulo del kernel y valor numérico. */
function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <tr>
      <th>{label}</th>
      <td className="num">{value}</td>
    </tr>
  );
}

/** Fase 2 — banco cuántico nativo materializado con la física del núcleo. */
export function QuantumCard({ view }: { view: QuantumView }) {
  return (
    <article className="kx-card">
      <h3>Fase 2 · banco cuántico nativo</h3>
      <p className="muted">{view.label}</p>
      <table className="summary">
        <tbody>
          <Row label="qubits vivos" value={view.qubits} />
          <Row label="colapsos" value={view.collapses} />
          <Row label="entropía media" value={`${fixed(view.entropyBits)} bit`} />
          <Row label="fases áureas" value={view.phases.map((phase) => fixed(phase, 2)).join(" · ")} />
          <Row label="convenciones de Bell" value={view.bell.length} />
        </tbody>
      </table>

      {view.register.length > 0 ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Qubit</th>
                <th>dim</th>
                <th>entropía</th>
                <th>p(⊤)</th>
                <th>medido</th>
                <th>valencia</th>
                <th>enlaces</th>
              </tr>
            </thead>
            <tbody>
              {view.register.map((qubit) => (
                <tr key={qubit.name}>
                  <td className="glyph">{qubit.name}</td>
                  <td className="num">{qubit.dim}</td>
                  <td className="num">{fixed(qubit.entropyBits)}</td>
                  <td className="num">{fixed(qubit.topProbability)}</td>
                  <td>{qubit.outcome ?? "—"}</td>
                  <td>
                    {qubit.valence.observation.glyph} {qubit.valence.key}
                  </td>
                  <td className="muted">{qubit.entangledWith.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Sin raíces: el banco cuántico queda vacío.</p>
      )}

      {view.register.map((qubit) => (
        <details key={`a:${qubit.name}`} className="kx-detail">
          <summary>
            amplitudes de {qubit.name} · {qubit.measurements} medición(es)
          </summary>
          <table className="summary">
            <tbody>
              {qubit.amplitudes.slice(0, MAX_AMPLITUDES).map((amplitude, index) => (
                <tr key={`${qubit.name}:${index}`}>
                  <th>{qubit.basis[index] ?? `|${index}⟩`}</th>
                  <td className="num">{amplitude.label}</td>
                  <td className="num">|α| {fixed(amplitude.magnitude)}</td>
                  <td className="num">φ {fixed(amplitude.phase)}</td>
                  <td className="num">P {percent(amplitude.probability, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}

      {view.bindings.length > 0 ? (
        <ul className="kx-list">
          {view.bindings.map((binding) => (
            <li key={binding.label}>
              <span className="kx-tag">{binding.phase}</span> {binding.left} ↔ {binding.right} ·{" "}
              {binding.meaning} · ⟨A·B⟩ {fixed(binding.correlation)} · fuerza{" "}
              {percent(binding.strength)} · época {binding.epoch} ·{" "}
              <span className={binding.valence.contradiction ? "kx-warn" : "kx-ok"}>
                {binding.valence.observation.glyph} {binding.valence.key}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Sin pares: no hubo entrelazamiento.</p>
      )}

      <details className="kx-detail">
        <summary>catálogo de convenciones de Bell ({view.bell.length})</summary>
        <table className="summary">
          <tbody>
            {view.bell.map((bell) => (
              <tr key={bell.phase}>
                <th>{bell.phase}</th>
                <td className="muted">{bell.meaning}</td>
                <td className="num">⟨A·B⟩ {fixed(bell.correlation)}</td>
                <td className="num">{bell.joint.length} amplitudes</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  );
}

/** Fase 2 — malla holográfica global: convergencia con relojes vectoriales. */
export function MeshCard({
  view,
  peers,
  rounds,
  threaded,
  onPeers,
  onRounds,
  onThreaded,
}: {
  view: MeshView;
  peers: number;
  rounds: number;
  threaded: boolean;
  onPeers: (value: number) => void;
  onRounds: (value: number) => void;
  onThreaded: (value: boolean) => void;
}) {
  return (
    <article className="kx-card">
      <h3>Fase 2 · malla holográfica</h3>
      <p className="muted">{view.label}</p>
      <div className="row kx-controls">
        <label className="kx-field">
          peers
          <input
            type="number"
            min={1}
            max={MAX_PANEL_PEERS}
            value={peers}
            onChange={(event) => {
              onPeers(Number(event.target.value));
            }}
          />
        </label>
        <label className="kx-field">
          rondas
          <input
            type="number"
            min={1}
            max={MAX_PANEL_ROUNDS}
            value={rounds}
            onChange={(event) => {
              onRounds(Number(event.target.value));
            }}
          />
        </label>
        <label className="kx-check">
          <input
            type="checkbox"
            checked={threaded}
            onChange={(event) => {
              onThreaded(event.target.checked);
            }}
          />
          bus con hilos std
        </label>
      </div>

      <table className="summary">
        <tbody>
          <Row label="rondas efectivas" value={view.rounds} />
          <Row label="peers" value={view.peers} />
          <Row label="entradas" value={view.entries} />
          <Row label="fusionadas" value={view.merged} />
          <Row label="conflictos" value={view.conflicts} />
          <Row label="obsoletas" value={view.stale} />
          <Row label="sin efecto" value={view.noop} />
          <Row label="entregas del bus" value={view.deliveries} />
          <Row label="cable" value={bytes(view.wireBytes)} />
          <Row label="época" value={view.epoch} />
          <Row label="deriva" value={fixed(view.drift)} />
          <Row label="convergió" value={mark(view.converged)} />
          <Row label="digest de consenso" value={view.digest} />
          <Row label="micros (reloj de pared)" value={view.micros} />
        </tbody>
      </table>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nudo</th>
              <th>entradas</th>
              <th>época</th>
              <th>aceptados</th>
              <th>rechazados</th>
              <th>reloj</th>
              <th>holograma</th>
            </tr>
          </thead>
          <tbody>
            {view.nodes.map((node) => (
              <tr key={node.id}>
                <td className="num">{node.id}</td>
                <td>{node.name}</td>
                <td className="num">{node.entries}</td>
                <td className="num">{node.epoch}</td>
                <td className="num">{node.applied}</td>
                <td className="num">{node.rejected}</td>
                <td className="num">{node.clock}</td>
                <td className="num kx-mono">{node.hologram}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        El bus en hilos sólo cambia la planificación (relojes vectoriales y
        duración): el digest deriva del contenido.
      </p>
    </article>
  );
}

/** Fase 2 — Metal-IR: ISA de 32 bits, asignación de registros y bypass. */
export function MetalCard({
  view,
  device,
  onDevice,
}: {
  view: MetalView;
  device: string;
  onDevice: (value: string) => void;
}) {
  return (
    <article className="kx-card">
      <h3>Fase 2 · Metal-IR y bypass del driver</h3>
      <p className="muted">
        {view.label} · {view.signature}
      </p>
      <div className="row kx-controls">
        <label className="kx-field">
          dispositivo
          <select
            value={device}
            onChange={(event) => {
              onDevice(event.target.value);
            }}
          >
            <option value="cpu">CPU</option>
            <option value="gpu">GPU (vectorial)</option>
          </select>
        </label>
        <span className="muted">
          destino: {view.deviceLabel} · descriptor ISA {view.descriptor}
        </span>
      </div>

      <table className="summary">
        <tbody>
          <Row label="instrucciones" value={view.ops} />
          <Row label="palabras de 32 bits" value={view.wordCount} />
          <Row
            label="proyección recortada"
            value={view.truncated ? `${view.instructions.length} op(s) · ${view.words.length} palabra(s)` : "completa"}
          />
          <Row label="carriles por registro" value={view.lanes} />
          <Row label="barreras de sincronización" value={view.barriers} />
          <Row label="rangos de vida" value={view.ranges} />
          <Row label="registros asignados" value={view.allocated} />
          <Row label="derramados" value={`${view.spilled} (${bytes(view.spillBytes)})`} />
          <Row label="presión de registros" value={percent(view.pressure, 2)} />
          <Row label="ocupación del banco" value={percent(view.occupancy, 2)} />
          <Row label="capacidad física" value={`${view.capacity} · layout ${bytes(view.layoutBytes)}`} />
          <Row label="despacho" value={view.dispatch} />
          <Row
            label="oleadas · carriles · ciclos"
            value={`${view.waves} · ${view.dispatchLanes} · ${view.dispatchCycles}`}
          />
          <Row label="ocupación del despacho" value={percent(view.dispatchOccupancy, 2)} />
          <Row label="bypass" value={view.bypass} />
          <Row
            label="anillo · MMIO"
            value={`${view.ringEntries} entrada(s) · ${view.mmioBase}`}
          />
          <Row
            label="syscalls evitadas"
            value={`${view.avoidedSyscalls} + ${view.bypassedSyscalls} · ${view.latencySavedNs} ns`}
          />
        </tbody>
      </table>

      <table>
        <thead>
          <tr>
            <th>Banco</th>
            <th>clase</th>
            <th>usados</th>
            <th>ocupación</th>
            <th>anchura</th>
            <th>alineación</th>
            <th>bytes</th>
          </tr>
        </thead>
        <tbody>
          {view.registers.map((register) => (
            <tr key={register.class}>
              <td>
                <span className="glyph">{register.glyph}</span> {register.label}
              </td>
              <td className="num">{register.class}</td>
              <td className="num">
                {register.used}/{register.slots}
              </td>
              <td className="num">{percent(register.ratio)}</td>
              <td className="num">{register.width}</td>
              <td className="num">{register.alignment}</td>
              <td className="num">{bytes(register.bankBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details className="kx-detail">
        <summary>
          instrucciones ({view.instructions.length}
          {view.ops > view.instructions.length ? ` de ${view.ops}` : ""})
        </summary>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Palabra</th>
                <th>Opcode</th>
                <th>dst</th>
                <th>src</th>
                <th>imm</th>
                <th>carriles</th>
                <th>máscara</th>
                <th>ciclos</th>
                <th>latencia</th>
                <th>origen</th>
                <th>kernel</th>
              </tr>
            </thead>
            <tbody>
              {view.instructions.slice(0, MAX_ROWS).map((op, index) => (
                <tr key={`${op.word}:${index}`}>
                  <td className="kx-mono">{op.word}</td>
                  <td>
                    {op.opcode}
                    {op.barrier ? " ⛓" : ""}
                  </td>
                  <td className="num">{op.dst ?? "—"}</td>
                  <td className="num">{op.src.join(", ") || "—"}</td>
                  <td className="num">{op.imm ?? "—"}</td>
                  <td className="num">{op.lanes}</td>
                  <td className="num">0x{op.laneMask.toString(16)}</td>
                  <td className="num">{op.cycles}</td>
                  <td className="num">{op.latency}</td>
                  <td className="muted">{op.origin}</td>
                  <td className="muted">{op.describe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="kx-detail">
        <summary>
          palabras de la ISA ({view.words.length}
          {view.wordCount > view.words.length ? ` de ${view.wordCount}` : ""})
        </summary>
        <ul className="kx-chips">
          {view.words.slice(0, MAX_ROWS).map((word, index) => (
            <li key={`${word}:${index}`} className="kx-chip kx-mono">
              {word}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

/** Fase 2 — control temporal `Δ⁻¹`: pila de estados y diario de deltas. */
export function TimelineCard({ view }: { view: TimelineView }) {
  return (
    <article className="kx-card">
      <h3>Fase 2 · control temporal Δ⁻¹</h3>
      <p className="muted">{view.label}</p>
      <table className="summary">
        <tbody>
          <Row label="deltas totales" value={view.total} />
          <Row label="vivos" value={view.live} />
          <Row label="revertidos" value={view.reverted} />
          <Row label="profundidad de la pila" value={view.depth} />
          <Row label="marca actual" value={view.nextMarker} />
          <Row label="diario recortado" value={mark(view.truncated)} />
          <Row
            label="cumbre"
            value={
              view.top === null || view.topLabel === null
                ? "—"
                : `${view.topLabel} · ${view.top.observation.glyph} ${view.top.key}`
            }
          />
        </tbody>
      </table>

      {view.paradox ? (
        <p className="kx-warn">
          paradoja en la cumbre: {view.paradox.description} · ⊤ {fixed(view.paradox.truth)} · ⊥{" "}
          {fixed(view.paradox.falsity)}
        </p>
      ) : (
        <p className="muted">Sin paradojas irresolubles en la cumbre.</p>
      )}

      {view.stack.length > 0 ? (
        <ul className="kx-list">
          {view.stack.slice(-MAX_ROWS).map((state, index) => (
            <li key={`${state}:${index}`} className="kx-mono">
              {index === view.stack.slice(-MAX_ROWS).length - 1 ? "▲ " : "· "}
              {state}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Pila de estados vacía.</p>
      )}

      {view.deltas.length > 0 ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Δ</th>
                <th>Etiqueta</th>
                <th>naturaleza</th>
                <th>Δ⁻¹</th>
                <th>revertido</th>
                <th>micros</th>
              </tr>
            </thead>
            <tbody>
              {view.deltas.slice(-MAX_ROWS).map((delta) => (
                <tr key={delta.id}>
                  <td className="num">{delta.id}</td>
                  <td>{delta.label}</td>
                  <td>{delta.kind}</td>
                  <td className="num">{delta.inverse}</td>
                  <td>{delta.reverted ? "sí" : "no"}</td>
                  <td className="num">{delta.atMicros}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Diario vacío: el documento no colapsó estados.</p>
      )}
    </article>
  );
}

/** Fase 3 — reparto áureo/Fibonacci: métricas, rejilla `φ` y filas. */
function FractalReport({ title, view }: { title: string; view: FractalMemoryView }) {
  return (
    <div className="kx-sub">
      <h4>{title}</h4>
      <p className="muted">{view.label}</p>
      <table className="summary">
        <tbody>
          <Row label="nodos" value={view.nodes} />
          <Row label="carga útil" value={bytes(view.payloadBytes)} />
          <Row label="extensión (Σ strides)" value={bytes(view.spanBytes)} />
          <Row label="relleno interno" value={bytes(view.paddingBytes)} />
          <Row label="fragmentación medida" value={percent(view.fragmentation, 2)} />
          <Row
            label="cota áurea (1 − 1/φ)"
            value={`${percent(view.bound, 2)} · base ${percent(view.baselineBound, 2)}`}
          />
          <Row label="mejora de la cota" value={percent(view.improvement, 2)} />
          <Row label="dentro de la cota" value={mark(view.withinBound)} />
          <Row label="φ del núcleo" value={fixed(view.phi, 6)} />
          <Row label="ángulo áureo" value={`${fixed(view.goldenAngle, 6)} rad`} />
          <Row label="escrituras efectivas" value={view.writes} />
          <Row label="entropía" value={fixed(view.entropy, 4)} />
        </tbody>
      </table>

      <ul className="kx-chips">
        {view.fibonacci.map((term) => (
          <li key={`f:${term}`} className="kx-chip kx-mono">
            {term}
          </li>
        ))}
      </ul>

      {view.goldenRanks.length > 0 ? (
        <p className="muted">
          permutación de phyllotaxis ({view.goldenRanks.length} rangos):{" "}
          <span className="kx-mono">{view.goldenRanks.slice(0, MAX_ROWS).join(" · ")}</span>
        </p>
      ) : null}

      {view.cells.length > 0 ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Nodo</th>
                <th>clave</th>
                <th>bytes</th>
                <th>stride (Fibo)</th>
                <th>ranura</th>
                <th>rango φ</th>
                <th>afinidad</th>
              </tr>
            </thead>
            <tbody>
              {view.cells.slice(0, MAX_ROWS).map((cell, index) => (
                <tr key={`${cell.label}:${cell.key}:${index}`}>
                  <td>{cell.label || "—"}</td>
                  <td className="kx-mono">{cell.key || "—"}</td>
                  <td className="num">{cell.bytes}</td>
                  <td className="num">{cell.stride}</td>
                  <td className="num">{cell.slot}</td>
                  <td className="num">{cell.rank}</td>
                  <td className="num">{fixed(cell.affinity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Sin nodos repartidos.</p>
      )}
    </div>
  );
}

/** Fase 3 — reparto áureo de la memoria del documento y plan puro del panel. */
export function FractalCard({
  memory,
  plan,
  planText,
  onPlanText,
  onPlan,
}: {
  /** Reparto de la memoria holográfica del documento (runtime del núcleo). */
  memory: FractalMemoryView;
  /** Reparto puro de los anchos escritos (puede no estar calculado aún). */
  plan: FractalMemoryView | null;
  planText: string;
  onPlanText: (value: string) => void;
  onPlan: () => void;
}) {
  return (
    <article className="kx-card">
      <h3>Fase 3 · memoria áurea y de Fibonacci</h3>
      <div className="row kx-controls">
        <input
          className="path"
          value={planText}
          spellCheck={false}
          placeholder="anchos en bytes, separados por comas"
          onChange={(event) => {
            onPlanText(event.target.value);
          }}
        />
        <button type="button" onClick={onPlan}>
          Repartir
        </button>
      </div>
      <FractalReport title="memoria del documento" view={memory} />
      {plan ? <FractalReport title="plan áureo puro del panel" view={plan} /> : null}
    </article>
  );
}

/** Huella abreviada para tablas: 16 dígitos bastan (la completa va en el chip). */
function short(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 16)}…` : hash;
}

/**
 * Fase 5 — puente kernel → IDE: contrato, instantánea y catálogo del sobre.
 *
 * Todo lo que se pinta lo decidió el núcleo (`bara::ide_bridge`): el veredicto
 * de la puerta, el peligro en milésimas, las marcas y el acta de la inmunidad.
 * La tarjeta sólo añade **alertas pasivas de contrato** (`bridgeWarnings`):
 * deriva de esquema, huella de manifiesto distinta o sección ausente. Nunca
 * bloquea el panel ni reinterpreta un veredicto.
 */
export function BridgeCard({
  document,
  contract,
}: {
  /** Instantánea que capturó el núcleo sobre el documento del editor. */
  document: BridgeSnapshot;
  /** Manifiesto cargado al conectar; `null` mientras no llegue. */
  contract: BridgeManifest | null;
}) {
  const warnings = bridgeWarnings(document, contract);
  const { identidad, inmunidad, pasarela, nucleo } = document.secciones;
  const presente = document.catalogo.filter((entry) => entry.presente).length;
  const burbuja = pasarela.rabo[0];

  return (
    <article className="kx-card">
      <h3>Fase 5 · puente kernel → IDE</h3>
      <p className="muted">
        {identidad.dominio} · {identidad.solo_lectura ? "sólo lectura" : "identidad no declarada"} ·{" "}
        {identidad.muta_nucleo ? "mutaría el núcleo" : "no muta el núcleo"} ·{" "}
        {identidad.rechaza ? "rechaza cargas" : "puerta sin rechazos"}
      </p>
      <ul className="kx-chips">
        <li className="kx-chip kx-mono">{document.esquema}</li>
        <li className="kx-chip kx-mono">v{document.version}</li>
        <li className="kx-chip kx-mono">huella {document.huella}</li>
      </ul>
      <table className="summary">
        <tbody>
          <Row label="manifiesto del sobre" value={short(document.manifiesto)} />
          <Row label="manifiesto cargado" value={contract ? short(contract.huella) : "—"} />
          <Row label="secciones presentes" value={`${presente}/${document.catalogo.length}`} />
          <Row label="bytes del sobre" value={bytes(document.bytes)} />
          <Row label="completa" value={mark(document.completa)} />
        </tbody>
      </table>

      {warnings.length > 0 ? (
        <ul className="kx-checks">
          {warnings.map((warning) => (
            <li key={warning} className="kx-warn">
              ⚠ {warning}
            </li>
          ))}
        </ul>
      ) : (
        <p className="kx-ok">✓ contrato respetado: el panel lee las cuatro secciones canónicas.</p>
      )}

      <p className="muted">catálogo del sobre · orden canónico del manifiesto</p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>sección</th>
              <th>orden</th>
              <th>bytes</th>
              <th>huella</th>
              <th>origen</th>
            </tr>
          </thead>
          <tbody>
            {document.catalogo.map((entry) => (
              <tr key={entry.nombre}>
                <td className="glyph">
                  {entry.glifo} {entry.nombre}
                </td>
                <td className="num">{entry.orden}</td>
                <td className="num">{bytes(entry.bytes)}</td>
                <td className="kx-mono">{entry.presente ? short(entry.huella) : "ausente"}</td>
                <td className="muted">
                  {identidad.manifiesto.secciones.find((spec) => spec.nombre === entry.nombre)
                    ?.origen ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted">inmunidad adaptativa · respuesta al documento</p>
      <table className="summary">
        <tbody>
          <Row label="huella del sistema" value={short(inmunidad.huella)} />
          <Row label="tolerancia" value={fixed(inmunidad.tolerancia)} />
          <Row label="afinidad media" value={fixed(inmunidad.afinidad_media)} />
          <Row
            label="repertorio"
            value={`${inmunidad.repertorio.estirpes}/${inmunidad.capacidad} estirpes`}
          />
          <Row label="repertorio lleno" value={mark(inmunidad.repertorio_lleno)} />
          <Row
            label="respuestas"
            value={`${inmunidad.contadores.total} · toleradas ${inmunidad.contadores.tolerados} · neutralizadas ${inmunidad.contadores.neutralizados}`}
          />
        </tbody>
      </table>
      <p className="muted">{inmunidad.acta}</p>

      <p className="muted">pasarela · veredicto del documento</p>
      <table className="summary">
        <tbody>
          <Row label="burbujas registradas" value={pasarela.burbujas} />
          <Row
            label="censo"
            value={`inocuas ${pasarela.censo.inocuas} · absorbidas ${pasarela.censo.absorbidas} · neutralizadas ${pasarela.censo.neutralizadas} · cuarentena ${pasarela.censo.cuarentena}`}
          />
          <Row label="bytes inertes" value={bytes(pasarela.bytes_inertes)} />
          <Row label="nodos sellados" value={pasarela.nodos_sellados} />
          <Row label="marcas" value={pasarela.marcas} />
          <Row label="regiones · memoria" value={`${pasarela.regiones} · ${pasarela.memoria}`} />
          <Row label="rabo publicado" value={`${pasarela.rabo.length}/${pasarela.cota_rabo}`} />
        </tbody>
      </table>
      {burbuja ? (
        <>
          <p className={burbuja.marcas.length > 0 ? "kx-warn" : "kx-ok"}>
            {burbuja.glifo} {burbuja.veredicto} · peligro {burbuja.peligro} ‰ ·{" "}
            {bytes(burbuja.bytes)} · {burbuja.origen}
          </p>
          {burbuja.marcas.length > 0 ? (
            <ul className="kx-chips">
              {burbuja.marcas.map((marca) => (
                <li key={marca} className="kx-chip">
                  {marca}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Sin marcas: la carga entró sin disparar patrones.</p>
          )}
          <p className="muted">{burbuja.acta}</p>
        </>
      ) : (
        <p className="muted">Sin burbujas en el rabo.</p>
      )}

      <p className="muted">núcleo · estado soberano leído</p>
      <table className="summary">
        <tbody>
          <Row
            label="pila"
            value={`${nucleo.pila.profundidad} · ${nucleo.pila.cumbre ?? "vacía"}`}
          />
          <Row label="memoria · regiones" value={`${nucleo.memoria} · ${nucleo.regiones}`} />
          <Row
            label="axiomas"
            value={`${nucleo.axiomas.total} (generación ${nucleo.axiomas.generacion})`}
          />
          <Row
            label="tiempo"
            value={`${nucleo.tiempo.instantaneas} instantáneas · ${nucleo.tiempo.deltas} deltas`}
          />
          <Row
            label="qubits"
            value={`${nucleo.qubits.vivos} vivos · ${nucleo.qubits.colapsos} colapsos`}
          />
          <Row
            label="malla"
            value={`${nucleo.malla.nodos} nodos · época ${nucleo.malla.epoca}`}
          />
          <Row
            label="certificado ZK"
            value={
              nucleo.certificado
                ? `${nucleo.certificado.etiqueta} · ${nucleo.certificado.restricciones} restricciones · ${mark(nucleo.certificado.verificado)}`
                : "no capturado"
            }
          />
          <Row
            label="Metal‑IR"
            value={
              nucleo.metal
                ? `${nucleo.metal.etiqueta} · ${nucleo.metal.instrucciones} ops · ${nucleo.metal.palabras} palabras`
                : "no compilado"
            }
          />
          <Row
            label="log ontológico"
            value={`${nucleo.log.eventos} eventos · ${nucleo.log.tolerados} tolerados · último ${nucleo.log.ultimo ?? "—"}`}
          />
        </tbody>
      </table>
    </article>
  );
}






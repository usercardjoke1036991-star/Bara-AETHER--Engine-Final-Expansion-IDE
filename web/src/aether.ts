// Puente tipado de las proyecciones AETHER-Ω del kernel (`bara-ide/src/aether.rs`).
//
// Cada tipo replica la proyección `serde` (`camelCase`) que publica el módulo
// `aether` del backend: el compilador de TypeScript verifica así el contrato del
// IPC igual que lo hace con el modelo de análisis de `engine.ts`.
//
// Ninguna decisión ontológica vive aquí: la interfaz sólo pide, acota los
// parámetros del panel y pinta lo que el núcleo ya decidió.

import { invoke } from "@tauri-apps/api/core";

import type { BelnapPoint } from "./engine";

// ─────────────────────────────────────────────────────────────────────────
// Fase 1 — Autopoiesis, Belnap y puerta ZK
// ─────────────────────────────────────────────────────────────────────────

/** Un axioma del mutador autopoiético (`Axiom` del kernel). */
export interface AxiomView {
  /** Raíz que lo originó. */
  root: string;
  /** Generación evolutiva en la que nació. */
  generation: number;
  /** Regla lógica inventada por el mutador del núcleo. */
  rule: string;
  /** Valencia paraconsistente, clasificada por el kernel. */
  valence: BelnapPoint;
  /** ¿La valencia es `⊤∧⊥` (contradicción retenida, jamás explosión)? */
  tolerated: boolean;
}

/** Una comprobación de la puerta ZK. */
export interface ZkCheckView {
  name: string;
  passed: boolean;
}

/** Certificado de la etapa de compilación (`ZkCertificate`). */
export interface ZkGateView {
  /** Enunciado público certificado. */
  label: string;
  /** Veredicto de la verificación independiente. */
  verified: boolean;
  /** Número de invariantes (grado del polinomio de anulación). */
  constraints: number;
  /** Punto-desafío Fiat–Shamir, en hexadecimal. */
  challenge: string;
  /** Compromisos emitidos por el probador (`A B C H`). */
  commitments: number;
  /** Entradas públicas comprometidas. */
  publicInputs: number;
  checks: ZkCheckView[];
  /** Resumen textual del kernel para el log ontológico. */
  summary: string;
}

/** Informe de la fase 1 sobre el documento abierto. */
export interface AutopoiesisReport {
  /** Raíces distintas vistas en el documento. */
  roots: number;
  /** Raíces que el kernel desconoce: disparan la axiogénesis, en orden. */
  unknownRoots: string[];
  /** Axiomas vivos del mutador, en orden determinista. */
  axioms: AxiomView[];
  /** Generación evolutiva alcanzada por el lenguaje. */
  generation: number;
  /** Axiomas cuya valencia es `⊤∧⊥` (contradicciones retenidas). */
  contradictions: number;
  gate: ZkGateView;
  /** ¿El AST quedó certificado? */
  certified: boolean;
  /** Veredicto legible para la cabecera del panel. */
  verdict: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Banco cuántico nativo
// ─────────────────────────────────────────────────────────────────────────

/** Una amplitud compleja proyectada (`Amplitude`). */
export interface AmplitudeView {
  /** Etiqueta compacta `a+b·i` del kernel. */
  label: string;
  re: number;
  im: number;
  /** Módulo `|α|`. */
  magnitude: number;
  /** Fase `arg(α)`, en radianes. */
  phase: number;
  /** Probabilidad de Born `|α|²`. */
  probability: number;
}

/** Un qubit nativo proyectado (`Qubit<|ψ⟩>`). */
export interface QubitView {
  /** Nombre simbólico (la raíz del documento que lo materializó). */
  name: string;
  /** Dimensión del espacio de Hilbert declarado. */
  dim: number;
  /** Etiquetas de la base computacional (`|0⟩`, `|1⟩`…). */
  basis: string[];
  amplitudes: AmplitudeView[];
  /** Distribución de Born `|αᵢ|²`. */
  probabilities: number[];
  /** Entropía de Shannon, en bits. */
  entropyBits: number;
  /** Probabilidad del estado más probable. */
  topProbability: number;
  /** Qubits con los que está entrelazado. */
  entangledWith: string[];
  /** Índice medido, si colapsó. */
  measured: number | null;
  /** Etiqueta del resultado medido (`|0⟩`/`|⊤⟩`…). */
  outcome: string | null;
  /** Mediciones aplicadas. */
  measurements: number;
  /** Valencia paraconsistente (traza parcial si está entrelazado). */
  valence: BelnapPoint;
}

/** Un enlace de entrelazamiento proyectado (`EntanglementBinding`). */
export interface BindingView {
  /** Etiqueta del enlace, redactada por el kernel. */
  label: string;
  left: string;
  right: string;
  /** Convención de Bell (`Φ⁺`, `Φ⁻`, `Ψ⁺`, `Ψ⁻`). */
  phase: string;
  /** Significado ontológico de la convención. */
  meaning: string;
  /** Correlación esperada `⟨A·B⟩`. */
  correlation: number;
  /** Fuerza del enlace, en `[0,1]`. */
  strength: number;
  /** Época en la que se estableció. */
  epoch: number;
  /** Vector conjunto de la campana (cuatro amplitudes). */
  joint: AmplitudeView[];
  /** Valencia de la descripción local (traza parcial ⇒ `⊤∧⊥`). */
  valence: BelnapPoint;
}

/** Una convención de Bell con su campana conjunta (catálogo del panel). */
export interface BellView {
  phase: string;
  meaning: string;
  correlation: number;
  joint: AmplitudeView[];
}

/** Banco cuántico del documento, materializado sobre el kernel. */
export interface QuantumView {
  /** Registro de qubits vivos, en orden determinista. */
  register: QubitView[];
  bindings: BindingView[];
  /** Catálogo de las cuatro convenciones de Bell. */
  bell: BellView[];
  /** Qubits vivos. */
  qubits: number;
  /** Colapsos acumulados. */
  collapses: number;
  /** Entropía media del registro, en bits. */
  entropyBits: number;
  /** Fases áureas `i·θ_g` inyectadas a cada qubit, en radianes. */
  phases: number[];
  /** Etiqueta legible del banco para la cabecera del panel. */
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Malla holográfica global
// ─────────────────────────────────────────────────────────────────────────

/** Un nodo (réplica) de la malla proyectado (`MeshNode`). */
export interface MeshNodeView {
  /** Identificador del nudo en la retícula. */
  id: number;
  /** Nombre simbólico del nudo. */
  name: string;
  /** Entradas retenidas. */
  entries: number;
  /** Huella holográfica conjunta, en hexadecimal. */
  hologram: string;
  /** Época conocida. */
  epoch: number;
  /** Marcos aceptados. */
  applied: number;
  /** Marcos rechazados (divergencias no fusionables). */
  rejected: number;
  /** Reloj vectorial, redactado por el kernel. */
  clock: string;
}

/** Estado de la malla holográfica tras sincronizar. */
export interface MeshView {
  /** Rondas efectivas. */
  rounds: number;
  /** Peers participantes. */
  peers: number;
  /** Entradas participantes. */
  entries: number;
  /** Entradas fusionadas. */
  merged: number;
  /** Conflictos resueltos por reloj vectorial. */
  conflicts: number;
  /** Marcos obsoletos descartados. */
  stale: number;
  /** Marcos sin efecto (idempotencia). */
  noop: number;
  /** Entregas del bus. */
  deliveries: number;
  /** Bytes de cable. */
  wireBytes: number;
  /** Digest de consenso, en hexadecimal. */
  digest: string;
  /** Época de la malla. */
  epoch: number;
  /** ¿Convergió la retícula? */
  converged: boolean;
  /** Deriva entre huellas. */
  drift: number;
  /** ¿Se sincronizó con hilos `std`? */
  threaded: boolean;
  /** NO DETERMINISTA (A7): duración del ciclo, en microsegundos. */
  micros: number;
  /** Etiqueta legible del informe, redactada por el kernel. */
  label: string;
  /** Réplicas, en orden estable. */
  nodes: MeshNodeView[];
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Metal-IR y bypass del driver
// ─────────────────────────────────────────────────────────────────────────

/** Una instrucción Metal-IR proyectada (`MetalOp`). */
export interface MetalOpView {
  /** Palabra codificada de 32 bits, en hexadecimal. */
  word: string;
  /** Mnemónico del opcode. */
  opcode: string;
  /** ¿Es una barrera de sincronización de hilos? */
  barrier: boolean;
  /** Registro destino (virtual). */
  dst: number | null;
  /** Registros fuente (virtuales). */
  src: number[];
  /** Inmediato, si lo hay. */
  imm: number | null;
  /** Carriles SIMD despachados. */
  lanes: number;
  /** Máscara de carriles efectiva. */
  laneMask: number;
  /** Ciclos de emisión. */
  cycles: number;
  /** Latencia del opcode en el modelo del kernel. */
  latency: number;
  /** Regla del lenguaje que la originó. */
  origin: string;
  /** Notación legible del kernel. */
  describe: string;
}

/** Un banco de registros con su ocupación (`RegisterBank` + `RegAllocation`). */
export interface RegisterView {
  /** Prefijo de clase (`R`, `F`, `V`, `P`, `S`). */
  class: string;
  /** Glifo del log ontológico. */
  glyph: string;
  /** Descripción del banco, redactada por el kernel. */
  label: string;
  /** Registros del banco. */
  slots: number;
  /** Registros asignados. */
  used: number;
  /** Ocupación `used / slots`. */
  ratio: number;
  /** Anchura en bytes. */
  width: number;
  /** Alineación natural en bytes. */
  alignment: number;
  /** ¿Banco enmascarado (SIMD)? */
  masking: boolean;
  /** Bytes totales del banco. */
  bankBytes: number;
}

/** Metal-IR del documento con despacho y bypass del driver. */
export interface MetalView {
  /** Etiqueta del programa. */
  label: string;
  /** Nombre del dispositivo destino, tal como se pidió. */
  device: string;
  /** Etiqueta del dispositivo (`CPU`/`GPU`). */
  deviceLabel: string;
  /** Instrucciones emitidas. */
  ops: number;
  /** Instrucciones proyectadas (recortadas a `MAX_INSTRUCTIONS`). */
  instructions: MetalOpView[];
  /** ¿Se recortó algún vector para el panel? */
  truncated: boolean;
  /** Palabras de la ISA de 32 bits (recortadas a `MAX_WORDS`). */
  words: string[];
  /** Palabras totales emitidas. */
  wordCount: number;
  /** Carriles por registro. */
  lanes: number;
  /** Barreras de sincronización. */
  barriers: number;
  /** Registros virtuales asignados. */
  allocated: number;
  /** Registros desbordados a memoria. */
  spilled: number;
  /** Bytes derramados. */
  spillBytes: number;
  /** Presión de registros, en `[0,1]`. */
  pressure: number;
  /** Ocupación del banco, en `[0,1]`. */
  occupancy: number;
  /** Capacidad física total (descriptor de hardware). */
  capacity: number;
  /** Bytes del layout físico de registros. */
  layoutBytes: number;
  /** Rangos de vida considerados. */
  ranges: number;
  /** Descriptor de hardware, en hexadecimal. */
  descriptor: string;
  /** Entradas del anillo de comandos del bypass. */
  ringEntries: number;
  /** Llamadas al sistema evitadas. */
  avoidedSyscalls: number;
  /** Latencia ahorrada por el bypass, en nanosegundos. */
  latencySavedNs: number;
  /** Base MMIO del bypass, en hexadecimal. */
  mmioBase: string;
  /** Oleadas del despacho. */
  waves: number;
  /** Carriles del despacho. */
  dispatchLanes: number;
  /** Ciclos del despacho. */
  dispatchCycles: number;
  /** Ocupación del despacho, en `[0,1]`. */
  dispatchOccupancy: number;
  /** Llamadas al sistema evitadas según el despacho. */
  bypassedSyscalls: number;
  /** Firma de la ISA completa, redactada por el kernel. */
  signature: string;
  /** Resumen del despacho, redactado por el kernel. */
  dispatch: string;
  /** Resumen del bypass, redactado por el kernel. */
  bypass: string;
  /** Bancos de registros con su ocupación. */
  registers: RegisterView[];
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Control temporal Δ⁻¹
// ─────────────────────────────────────────────────────────────────────────

/** Un delta `Δ` del diario temporal proyectado. */
export interface TimelineDeltaView {
  /** Identificador monótono del delta. */
  id: number;
  /** Etiqueta descriptiva, redactada por el kernel. */
  label: string;
  /** Naturaleza del delta (`push`, `pop`, `replace`). */
  kind: string;
  /** Operador inverso `Δ⁻¹` asociado. */
  inverse: string;
  /** ¿Ya fue revertido? */
  reverted: boolean;
  /** NO DETERMINISTA (A7): marca de reloj, en microsegundos. */
  atMicros: number;
}

/** Una paradoja irresoluble detectada por el kernel (`⊤∧⊥` absoluto). */
export interface ParadoxView {
  /** Descripción ontológica. */
  description: string;
  /** Masa de verdad. */
  truth: number;
  /** Masa de falsedad. */
  falsity: number;
}

/** Diario `Δ⁻¹` del documento y cumbre de la pila de estados. */
export interface TimelineView {
  /** Deltas proyectados (los más recientes, hasta `MAX_DELTAS`). */
  deltas: TimelineDeltaView[];
  /** Deltas totales del diario. */
  total: number;
  /** ¿Se recortó el diario para el panel? */
  truncated: boolean;
  /** Deltas vivos (no revertidos). */
  live: number;
  /** Deltas ya revertidos por un `Δ⁻¹`. */
  reverted: number;
  /** Profundidad de la pila de estados. */
  depth: number;
  /** Marca lógica del instante actual (próximo identificador). */
  nextMarker: number;
  /** Pila de estados como etiquetas (la cumbre al final). */
  stack: string[];
  /** Valencia de la cumbre de la pila. */
  top: BelnapPoint | null;
  /** Etiqueta de la cumbre de la pila. */
  topLabel: string | null;
  /** Paradoja detectada en la cumbre, si la hay. */
  paradox: ParadoxView | null;
  /** Etiqueta legible para la cabecera del panel. */
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 3 — Geometría áurea y de Fibonacci de la memoria
// ─────────────────────────────────────────────────────────────────────────

/** Una fila del reparto áureo (nodo de la memoria holográfica). */
export interface FractalCellView {
  /** Etiqueta lógica del nodo (`str:…`, `genesis:…`, `nodo-00`). */
  label: string;
  /** Clave topológica (hash FNV-1a), en hexadecimal. */
  key: string;
  /** Ancho lógico del registro, en bytes. */
  bytes: number;
  /** Paso de retícula: el Fibonacci inmediatamente mayor (`fib_ceil`). */
  stride: number;
  /** Desplazamiento en bytes dentro de la retícula. */
  slot: number;
  /** Rango en la secuencia de *phyllotaxis* `i·φ`. */
  rank: number;
  /** Afinidad con el haz holográfico de reconstrucción, en `[0,1]`. */
  affinity: number;
}

/** Geometría fractal del reparto de memoria (`FractalLayout`). */
export interface FractalMemoryView {
  /** Nodos repartidos. */
  nodes: number;
  /** Bytes útiles retenidos. */
  payloadBytes: number;
  /** Extensión total de la retícula (`Σ strides`). */
  spanBytes: number;
  /** Relleno interno de la retícula. */
  paddingBytes: number;
  /** Fragmentación medida: `padding / span`. */
  fragmentation: number;
  /** Cota teórica de la retícula áurea (`1 − 1/φ`). */
  bound: number;
  /** Cota teórica de los cubos potencia de dos (`0.5`). */
  baselineBound: number;
  /** Mejora relativa de la cota. */
  improvement: number;
  /** ¿La fragmentación medida respeta la cota áurea? */
  withinBound: boolean;
  /** Proporción áurea `φ` del núcleo. */
  phi: number;
  /** Ángulo áureo `2π/φ²`, en radianes. */
  goldenAngle: number;
  /** Permutación de *phyllotaxis* del reparto (vacía si excede la cota). */
  goldenRanks: number[];
  /** Términos de Fibonacci publicados: `F(0) … F(n−1)`. */
  fibonacci: number[];
  /** Escrituras físicas efectivas de la memoria (idempotentes). */
  writes: number;
  /** Entropía acumulada de la memoria (0 ⇒ idempotente). */
  entropy: number;
  /** Etiqueta legible del reparto, redactada por el kernel. */
  label: string;
  /** Filas del reparto, en orden de escritura. */
  cells: FractalCellView[];
}

// ─────────────────────────────────────────────────────────────────────────
// Cotas del panel
// ─────────────────────────────────────────────────────────────────────────
//
// Espejo documentado de las cotas de `aether` (Rust). La interfaz **acota**
// para no pedir trabajo desmedido, pero el núcleo vuelve a acotar por su
// cuenta: nunca es la interfaz la autoridad del límite.

/** Espejo de `aether::MAX_PEERS`. */
export const MAX_PANEL_PEERS = 16;
/** Espejo de `aether::MAX_ROUNDS`. */
export const MAX_PANEL_ROUNDS = 16;
/** Anchura por defecto de las filas del plan áureo del panel. */
export const DEFAULT_PLAN_WIDTHS = [64, 96, 160, 256, 416, 672, 1088];

// ─────────────────────────────────────────────────────────────────────────
// Comandos del IPC (proyecciones AETHER-Ω)
// ─────────────────────────────────────────────────────────────────────────
//
// Los siete comandos son funciones puras sobre el texto del editor: no tocan la
// sesión del oráculo ni comparten estado con ella.

/** Fase 1: autopoiesis, valencia de Belnap y puerta ZK del documento. */
export function kernelAutopoiesis(source: string): Promise<AutopoiesisReport> {
  return invoke<AutopoiesisReport>("autopoiesis", { source });
}

/** Fase 2: banco cuántico nativo del documento (determinista). */
export function quantumNative(source: string): Promise<QuantumView> {
  return invoke<QuantumView>("quantum_native", { source });
}

/**
 * Fase 2: sincroniza la malla holográfica del documento.
 *
 * `peers` y `rounds` se acotan en el núcleo (`1..=MAX_PEERS`, `1..=MAX_ROUNDS`);
 * con `threaded` el bus se reparte con hilos `std` y el **estado** convergido no
 * cambia (el digest deriva del contenido), pero los relojes vectoriales y la
 * duración sí dependen del planificador.
 */
export function meshSync(
  source: string,
  peers: number,
  rounds: number,
  threaded: boolean,
): Promise<MeshView> {
  return invoke<MeshView>("mesh_sync", { source, peers, rounds, threaded });
}

/**
 * Fase 2: baja el documento a Metal-IR para el dispositivo pedido.
 *
 * `device` acepta `"gpu"`/`"metal"`/`"vector"`; cualquier otro valor se resuelve
 * como CPU (sin fallar).
 */
export function metalIr(source: string, device: string | null = null): Promise<MetalView> {
  return invoke<MetalView>("metal_ir", { source, device });
}

/** Fase 2: diario `Δ⁻¹` del documento y cumbre de su pila de estados. */
export function temporalTimeline(source: string): Promise<TimelineView> {
  return invoke<TimelineView>("temporal_timeline", { source });
}

/** Fase 3: reparto áureo/Fibonacci de la memoria holográfica del documento. */
export function fractalMemory(source: string): Promise<FractalMemoryView> {
  return invoke<FractalMemoryView>("fractal_memory", { source });
}

/**
 * Fase 3: reparto áureo *puro* de una población de anchos, sin runtime.
 *
 * Total: una lista vacía produce el reparto vacío del núcleo (cero nodos, cero
 * fragmentación, cota respetada).
 */
export function fractalPlan(widths: number[]): Promise<FractalMemoryView> {
  return invoke<FractalMemoryView>("fractal_plan", { widths });
}

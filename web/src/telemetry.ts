// Puente tipado del Cockpit de telemetría (`bara-ide-desktop/src/telemetry.rs`).
//
// Los cuatro comandos son **proyecciones** del kernel congelado: el front-end
// no reimplementa inferencia, censo, memoria ni auditoría; sólo pide el JSON que
// el núcleo ya firmó y verifica el contrato del IPC con TypeScript.
//
// `transmute_input` es el único comando que muta el estado cognitivo de la
// ventana; los otros tres son lecturas (o la siembra perezosa del demo).

import { invoke } from "@tauri-apps/api/core";

// ─────────────────────────────────────────────────────────────────────────
// Manifiesto del sistema
// ─────────────────────────────────────────────────────────────────────────

/** Sección canónica del puente (`Manifest::canon`). */
export interface ManifestSection {
  /** Nombre canónico (`identidad`, `inmunidad`, `pasarela`, `nucleo`). */
  nombre: string;
  /** Glifo con el que el panel rotula la sección. */
  glifo: string;
  /** Posición canónica (0–3). */
  orden: number;
  /** Cota de bytes del cuerpo de la sección. */
  cota_bytes: number;
  /** Subsistema del núcleo del que sale el dato. */
  origen: string;
}

/**
 * Manifiesto ontológico + identidad del puente (`system_manifest`).
 *
 * `manifiesto` e `identidad` son los documentos anidados que publica
 * `bara::ide_bridge`; el panel no los reinterpreta: sólo muestra sus huellas y
 * las secciones que declara el contrato.
 */
export interface SystemManifest {
  esquema: string;
  version: string;
  dominio: string;
  huella_identidad: string;
  huella_manifiesto: string;
  manifiesto: unknown;
  identidad: unknown;
  secciones: ManifestSection[];
  /** Fragmento canónico con el que el Cockpit siembra el transmutador. */
  demo: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Marco cognitivo (`NeuralFrame::json`)
// ─────────────────────────────────────────────────────────────────────────

/** Recuento tetravalente en orden canónico `⊤ ⊥ ⊤∧⊥ ∅`. */
export interface BelnapCensus {
  verdadero: number;
  falso: number;
  contradictorio: number;
  indeterminado: number;
}

/** Informe de la última inferencia tetravalente. */
export interface InferenceView {
  nodos: number;
  reglas: number;
  aplicadas: number;
  cambiadas: number;
  derivadas: number;
  capas: number;
  truncado: boolean;
}

/** Consejo del motor para un estado `Both` antes del colapso. */
export interface ResolutionView {
  raiz: string;
  tactica: string;
  recomendacion: string;
}

/** Vista de la memoria a largo plazo del cockpit. */
export interface MemoryView {
  entradas: number;
  capacidad: number;
  llena: boolean;
  censo: BelnapCensus;
  /** Riesgo acumulado en milésimas. */
  riesgo: number;
  escrituras: number;
  huella: string;
}

/** Censo del índice semántico *Shoresh* (sin total: lo suma el panel). */
export interface SemanticCensus {
  verdadero: number;
  falso: number;
  contradictorio: number;
  indeterminado: number;
}

/** Foto del índice semántico `NeuralIT`. */
export interface SemanticView {
  ranuras: number;
  capacidad: number;
  nodos: number;
  censo: SemanticCensus;
  contradicciones: number;
  indeterminados: number;
  huella: string;
}

/** Marco cognitivo completo: inferencia, censo, memoria y semántica. */
export interface NeuralFrame {
  esquema: string;
  generacion: number;
  inferencia: InferenceView;
  censo: BelnapCensus;
  memoria: MemoryView | null;
  /** Último ciclo autopoiético; el Cockpit no lo pinta (siempre `null` hoy). */
  ciclo: unknown;
  semantica: SemanticView | null;
  /** Consejos para contradicciones `⊤∧⊥` que el núcleo ya calculó. */
  recomendaciones: ResolutionView[];
  /** Dieciséis carriles enteros del embedding simbólico. */
  embedding: number[];
  /** Coseno contra `ברא`, en milésimas `[-1000, 1000]`. */
  proximidad_mili: number;
  /** Carta métrica del AST que el núcleo acaba de medir. */
  topologia: TopoView;
  /** ¿Censo, memoria y semántica cuadran con el informe? */
  coherente: boolean;
}

/** Malla topológica en el JSON *snake_case* del marco. */
export interface TopoView {
  nodos: number;
  solapes: number;
  cohesion_mili: number;
  /** `null` si el documento tiene menos de dos puntos. */
  distancia: number | null;
  omitidos: number;
  foco: string;
  vecino: string;
  alerta: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Caja negra (`flight_recorder::inspect`)
// ─────────────────────────────────────────────────────────────────────────

/** Contadores del anillo estático del Flight Recorder. */
export interface FlightCounters {
  capacidad: number;
  reservadas: number;
  publicadas: number;
  sobrescritas: number;
  en_vuelo: number;
  ocupadas: number;
  llena: boolean;
}

/** Una entrada publicada en la caja negra. */
export interface FlightEntry {
  secuencia: number;
  /** Marca temporal del kernel. */
  marca: number;
  clase: string;
  glifo: string;
  codigo_clase: number;
  violacion: string;
  codigo_violacion: number;
  huella: string;
  conflicto: boolean;
}

/** Volcado de sólo lectura de la caja negra. */
export interface FlightLog {
  contadores: FlightCounters;
  omitidas: number;
  entradas: FlightEntry[];
  texto: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Transmutación (`transmuter::Transmutation`)
// ─────────────────────────────────────────────────────────────────────────

/** Lenguaje detectado por el transmutador. */
export interface TransmutationLanguage {
  tag: string;
  nombre: string;
}

/** Informe de auditoría y censo de sentencias. */
export interface TransmutationReport {
  sentencias: number;
  aceptadas: number;
  rechazadas: number;
  cuarentena: number;
  verdadero: number;
  falso: number;
  ambos: number;
  ninguno: number;
  sellados: number;
  truncado: boolean;
  lossy: boolean;
  auditoria_ok: boolean;
  reglas_superadas: number;
  reglas_totales: number;
}

/** Nodo del AST *Shoresh* destilado por el kernel. */
export interface TransmutationNode {
  raiz: string;
  original: string;
  aridad: number;
  tipo: string;
  tipo_glifo: string;
  riesgo: number;
  valencia: string;
  valencia_nombre: string;
  valencia_indice: number;
  sellado: boolean;
}

/** Índice semántico actualizado por una sincronización admitida. */
export interface SyncIndex {
  nodos: number;
  indexadas: number;
  fusionadas: number;
  ranuras: number;
  capacidad: number;
  huella: string;
  coherente: boolean;
}

/** Auditoría de la sincronización. */
export interface SyncAudit {
  superadas: number;
  totales: number;
  conforme: boolean;
}

/** Informe de `NeuralIt::synchronize_with` (sólo si fue admitida). */
export interface SyncReport {
  proposito: string;
  indice: SyncIndex;
  auditoria: SyncAudit;
  contradicciones: number;
  indeterminados: number;
  /** Billete de la sincronización (huella del contrato aplicado). */
  billete: string;
  coherente: boolean;
}

/** Dictamen completo de `transmute_input`. */
export interface TransmutationResult {
  /** ¿El AST se fusionó en el estado cognitivo? */
  admisible: boolean;
  lenguaje: TransmutationLanguage;
  informe: TransmutationReport;
  ast: TransmutationNode[];
  /** `null` si la transmutación no fue admitida. */
  sincronizacion: SyncReport | null;
  memoria: {
    ingeridas: number;
    omitidas: number;
  };
  /** Motivo del rechazo; `null` si fue admitida. */
  motivo: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Comandos del IPC
// ─────────────────────────────────────────────────────────────────────────

/**
 * Invoca un comando que publica JSON **como texto**.
 *
 * El backend del Cockpit devuelve `Result<String, String>` para entregar el
 * JSON firmado tal cual lo produjo el kernel; `invoke<T>` no lo deserializa
 * (devolvería un `string`). Parsear aquí conserva el contrato tipado y hace
 * visible un JSON corrupto como error legible, nunca como objeto a medias.
 */
async function invokeJson<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const raw = await invoke<string>(command, args);
  try {
    return JSON.parse(raw) as T;
  } catch (failure) {
    const detail = failure instanceof Error ? failure.message : String(failure);
    throw new Error(`${command}: JSON inválido del kernel (${detail})`);
  }
}

/** Manifiesto canónico + identidad del puente (lectura pura). */
export function systemManifest(): Promise<SystemManifest> {
  return invokeJson<SystemManifest>("get_system_manifest");
}

/**
 * Marco cognitivo de la ventana.
 *
 * La primera llamada siembra el estado con el demo canónico; las siguientes
 * reflejan la última transmutación admitida.
 */
export function neuralFrame(): Promise<NeuralFrame> {
  return invokeJson<NeuralFrame>("get_neural_frame");
}

/** Volcado de sólo lectura de la caja negra. */
export function flightRecorderLogs(): Promise<FlightLog> {
  return invokeJson<FlightLog>("get_flight_recorder_logs");
}

/**
 * Transmuta código/texto externo, lo audita y lo indexa si es admisible.
 *
 * El comando del backend declara `rename_all = "snake_case"`, así que el
 * argumento viaja como `source_code` (no `sourceCode`).
 */
export function transmuteInput(sourceCode: string): Promise<TransmutationResult> {
  return invokeJson<TransmutationResult>("transmute_input", { source_code: sourceCode });
}


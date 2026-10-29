// Puente tipado entre la interfaz React y el backend Tauri (`src-tauri/`).
//
// Los tipos replican exactamente el modelo de `bara-ide` compilado con la
// feature `serde` (nombres `camelCase`), de modo que el compilador de
// TypeScript verifica el contrato del IPC.

import { invoke } from "@tauri-apps/api/core";

/** Clase léxica emitida por el kernel (enum `TokenClass`). */
export type TokenClass =
  | "rootKnown"
  | "rootUnknown"
  | "identifier"
  | "number"
  | "str"
  | "newline"
  | "eof"
  | "punctuation";

/** Token del documento con su posición y sus dos representaciones. */
export interface TokenInfo {
  line: number;
  column: number;
  class: TokenClass;
  lexeme: string;
  display: string;
  glyph: string | null;
  meaning: string | null;
}

/** Recuento por clase léxica (`Summary`). */
export interface Summary {
  total: number;
  rootsKnown: number;
  rootsUnknown: number;
  identifiers: number;
  numbers: number;
  strings: number;
  punctuation: number;
  newlines: number;
  eof: number;
}

/** Uso de una raíz conocida dentro del documento (`RootUsage`). */
export interface RootUsage {
  glyph: string;
  meaning: string;
  count: number;
}

/** Entrada del catálogo de raíces conocidas (`RootEntry`). */
export interface RootEntry {
  glyph: string;
  meaning: string;
}

/** Documento *Shoresh* analizado por el kernel (`Analysis`). */
export interface Analysis {
  sourceChars: number;
  sourceLines: number;
  tokens: TokenInfo[];
  summary: Summary;
  roots: RootUsage[];
}

/** Programa *Shoresh* destilado por el léxico del kernel (`Translation`). */
export interface Translation {
  /** Raíces listas para compilar (vacío si el texto no aporta ninguna). */
  program: string;
  /** Raíces y operadores usados, en orden de aparición. */
  roots: string[];
  /** Raíces que el léxico desconocía y el oráculo sintetizó (autopoiesis). */
  synthesized: number;
}

/** Etiqueta corta de cada clase léxica (misma nomenclatura que la CLI). */
export const CLASS_LABEL: Record<TokenClass, string> = {
  rootKnown: "raíz",
  rootUnknown: "raíz?",
  identifier: "ident",
  number: "num",
  str: "cadena",
  newline: "nl",
  eof: "eof",
  punctuation: "signo",
};

/** Analiza el texto del editor con el lexer del kernel Bara. */
export function analyzeSource(source: string): Promise<Analysis> {
  return invoke<Analysis>("analyze_source", { source });
}

/**
 * Analiza un `.bara` ya confinado por el backend a la raíz activa.
 * La ruta no elige el workspace: un absoluto fuera de esa raíz se rechaza.
 */
export function analyzeFile(path: string): Promise<Analysis> {
  return invoke<Analysis>("analyze_file", { path });
}

/** Catálogo de las raíces semánticas que reconoce el kernel. */
export function kernelCatalogue(): Promise<RootEntry[]> {
  return invoke<RootEntry[]>("kernel_catalogue");
}

/** Documento de ejemplo (`samples/genesis.bara`) embebido en el backend. */
export function sampleGenesis(): Promise<string> {
  return invoke<string>("sample_genesis");
}

/**
 * Traduce lengua natural a *Shoresh* con el léxico del propio kernel.
 *
 * No es una heurística de la interfaz: es el mismo traductor que usa el oráculo
 * del REPL, así que el panel de IA puede enseñar el programa canónico
 * (y cuántas raíces nuevas hubo que sintetizar por autopoiesis).
 */
export function shoreshTranslate(text: string): Promise<Translation> {
  return invoke<Translation>("shoresh_translate", { text });
}

/** Texto de un `.bara` leído dentro de la raíz activa (la jaula vive en Rust). */
export function readDocument(path: string): Promise<string> {
  return invoke<string>("read_document", { path });
}

/** Normaliza cualquier fallo (IPC, disco, serialización) a una línea. */
export function describeError(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "error desconocido al invocar al kernel";
  if (message.includes("reading 'invoke'") || message.includes("__TAURI_INTERNALS__")) {
    return "Esta pestaña del navegador no es la ventana del IDE: no tiene el kernel. Ábrelo con la aplicación de escritorio.";
  }
  return message;
}

// ─────────────────────────────────────────────────────────────────────────
// Oráculo, biláttice de Belnap y control temporal (`Δ⁻¹`)
// ─────────────────────────────────────────────────────────────────────────
//
// Estos tipos replican la proyección que `bara-ide` publica del kernel
// (nombres `camelCase`), de modo que `tsc` verifica el contrato del IPC igual
// que lo hace con el modelo de análisis.

/** Observación discreta del kernel (`Observation`). */
export interface ObservationView {
  glyph: string;
  name: string;
}

/** Un punto de la biláttice de Belnap, clasificado por el kernel. */
export interface BelnapPoint {
  key: "true" | "false" | "both" | "neither";
  truth: number;
  falsity: number;
  observation: ObservationView;
  contradiction: boolean;
  designated: boolean;
}

/** Tablas `∧`, `∨` y negación de la biláttice de Belnap. */
export interface BelnapLattice {
  values: BelnapPoint[];
  conjunction: BelnapPoint[][];
  disjunction: BelnapPoint[][];
  negation: BelnapPoint[];
}

/** Evaluación de un par `(⊤, ⊥)` y de su negación paraconsistente. */
export interface BelnapEvaluation {
  point: BelnapPoint;
  negation: BelnapPoint;
}

/** Un turno del oráculo (`OracleTurn`), ya proyectado. */
export interface TurnView {
  input: string;
  intent: string;
  roots: string;
  reply: string;
  events: number;
  axioms: number;
  monitor: string;
  /** NO DETERMINISTA (A7): métrica de reloj de pared. */
  micros: number;
}

/** Un paso reversible del diario temporal (`Delta`). */
export interface DeltaView {
  id: number;
  label: string;
  inverse: string;
  reverted: boolean;
  /** NO DETERMINISTA (A7): métrica de reloj de pared. */
  atMicros: number;
}

/** Informe de un rebobinado `Δ⁻¹`. */
export interface RollbackView {
  marker: number;
  reverted: number;
  /** NO DETERMINISTA (A7): métrica de reloj de pared. */
  micros: number;
  paradox: string | null;
}

/** Estado de la sesión del oráculo con el control temporal aplicado. */
export interface SessionStatus {
  turns: number;
  events: number;
  rollbacks: number;
  synthesized: number;
  roots: string[];
  micros: number;
  appliedRollbacks: number[];
  stackDepth: number;
  timelineDepth: number;
  timelineTop: string | null;
  timelineObservation: ObservationView | null;
  timelineContradiction: boolean;
  deltas: number;
  reverted: number;
  nextMarker: number;
  memoryNodes: number;
  entropy: number;
  regions: number;
  axioms: number;
  generation: number;
  qubits: number;
  meshPeers: number;
  lastReply: string | null;
  /** Identificador de la carpeta activa. Vacío si el backend no lo estampó. */
  workspaceId: string;
}

/** Resultado de una operación de sesión: turno, rebobinados y estado. */
export interface TurnResult {
  turn: TurnView | null;
  rollbacks: RollbackView[];
  status: SessionStatus;
}

/** Conversa un turno con el oráculo del kernel (léxico y runtime nativos). */
export function oracleConverse(input: string): Promise<TurnResult> {
  return invoke<TurnResult>("oracle_converse", { input });
}

/** Estado de la sesión: informe del oráculo, `Δ⁻¹` y runtime del kernel. */
export function oracleStatus(): Promise<SessionStatus> {
  return invoke<SessionStatus>("oracle_status");
}

/** Turnos conversados en la sesión, en orden. */
export function oracleTurns(): Promise<TurnView[]> {
  return invoke<TurnView[]>("oracle_turns");
}

/** Cierra la sesión del oráculo y devuelve el estado virgen. */
export function oracleReset(): Promise<SessionStatus> {
  return invoke<SessionStatus>("oracle_reset");
}

/** Diario temporal `Δ⁻¹` completo del kernel. */
export function temporalDeltas(): Promise<DeltaView[]> {
  return invoke<DeltaView[]>("temporal_deltas");
}

/** Control temporal: rebobina `Δ⁻¹` hasta un marcador. */
export function temporalRollback(marker: number): Promise<TurnResult> {
  return invoke<TurnResult>("temporal_rollback", { marker });
}

/** Biláttice de Belnap completa, calculada por el kernel. */
export function belnapLattice(): Promise<BelnapLattice> {
  return invoke<BelnapLattice>("belnap_lattice");
}

/** Clasifica un par `(⊤, ⊥)` con la lógica de Belnap del kernel. */
export function belnapEvaluate(
  truth: number,
  falsity: number,
): Promise<BelnapEvaluation> {
  return invoke<BelnapEvaluation>("belnap_evaluate", { truth, falsity });
}

/** Estado del proceso hijo: `activo`, `reiniciando` o `caído`. */
export function kernelHostStatus(): Promise<string> {
  return invoke<string>("kernel_host_status");
}

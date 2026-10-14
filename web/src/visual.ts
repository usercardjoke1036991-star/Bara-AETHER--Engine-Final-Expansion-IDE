// Puente tipado del *Visual Builder* (`bara-ide/src/visual.rs`).
//
// Cada tipo replica la proyección `serde` (camelCase) del módulo `visual` del
// backend, de modo que el compilador de TypeScript verifica el contrato del IPC
// igual que lo hace con `engine.ts` y `aether.ts`.
//
// Ninguna decisión ontológica vive aquí: el kernel valida el lienzo (**estricto
// de todo o nada**), lo traduce a *Shoresh*, lo coloca en la retícula áurea y
// lo firma. La interfaz sólo edita el texto, pide y pinta.

import { invoke } from "@tauri-apps/api/core";

import type { BelnapPoint } from "./engine";

/** Celda de la espiral áurea con la que el kernel coloca cada bloque. */
export interface VisualCellView {
  /** Coordenada `x` en el disco del lienzo. */
  x: number;
  /** Coordenada `y`. */
  y: number;
  /** Radio `√k` sin escalar. */
  radius: number;
  /** Ángulo `k·2π/φ²`, en radianes. */
  angle: number;
}

/** Ranura de entrada de un bloque (struct `Slot` del kernel). */
export interface VisualSlotView {
  /** Índice del bloque productor: siempre **anterior** (grafo acíclico). */
  index: number;
  /** Tipo canónico declarado en la ranura. */
  typeName: string;
  /** Nombre hebreo del tipo. */
  typeLabel: string;
  /** Glifo ASCII del tipo. */
  typeGlyph: string;
  /** ¿La ranura no declara tipo (`unknown` = comodín)? */
  wildcard: boolean;
}

/** Nodo del AST *Shoresh* traducido a partir del lienzo. */
export interface VisualNodeView {
  /** Raíz triconsonántica. */
  root: string;
  /** Nombre original del bloque. */
  original: string;
  arity: number;
  retName: string;
  retLabel: string;
  retGlyph: string;
  hazard: number;
  sanitized: boolean;
  /** Valencia paraconsistente clasificada por el kernel. */
  valence: BelnapPoint;
}

/** Bloque del lienzo con su celda áurea y su valencia. */
export interface VisualBlockView {
  id: string;
  name: string;
  /** Clase canónica (`source`, `transform`, `guard`, `sink`), del kernel. */
  kind: string;
  /** Etiqueta legible de la clase. */
  kindLabel: string;
  arity: number;
  retName: string;
  retLabel: string;
  retGlyph: string;
  hazard: number;
  root: string;
  sanitized: boolean;
  inputs: VisualSlotView[];
  /** Celda del kernel (`null` sólo ante una incoherencia interna). */
  cell: VisualCellView | null;
  /** Valencia del nodo homólogo (`null` sólo ante una incoherencia interna). */
  valence: BelnapPoint | null;
}

/** Comprobación del informe, tal como la nombró el kernel. */
export interface VisualCheckView {
  name: string;
  passed: boolean;
}

/** Informe de validación del lienzo (`VisualReport` del kernel). */
export interface VisualReportView {
  blocks: number;
  edges: number;
  depth: number;
  hazardMean: number;
  hazardMax: number;
  /** Cota áurea del **peor caso**: `máximo + (máximo − mínimo)/φ`, saturada a 1. */
  hazardBound: number;
  sealed: number;
  /** Orden topológico (índices de bloque). */
  order: number[];
  cells: VisualCellView[];
  minDistance: number;
  radius: number;
  checks: VisualCheckView[];
  verdict: string;
  verified: boolean;
  /** Raíz de Merkle del ADN, en hexadecimal. */
  rootHex: string;
  /** Firma soberana del ADN, en hexadecimal. */
  signatureHex: string;
  /** Identificador público de la clave firmante. */
  keyId: number;
}

/** Resultado completo: AST firmado, bloques y programa *Shoresh*. */
export interface VisualBuildView {
  module: string;
  label: string;
  /** Programa *Shoresh* traducido, listo para el oráculo. */
  source: string;
  ast: VisualNodeView[];
  blocks: VisualBlockView[];
  report: VisualReportView;
}

/** Clase de bloque del contrato. */
export interface VisualKindView {
  name: string;
  label: string;
  forcesSeal: boolean;
}

/** Tipo del sistema Bara aceptado en `ret` y en las ranuras. */
export interface VisualTypeView {
  name: string;
  label: string;
  glyph: string;
}

/** Cotas del lienzo impuestas por el kernel. */
export interface VisualLimitsView {
  maxBlocks: number;
  maxBlueprintBytes: number;
  maxJsonDepth: number;
  maxIdChars: number;
  sealThreshold: number;
  minCellDistance: number;
}

/** Contrato del lienzo: clases, tipos y cotas. */
export interface VisualCatalogueView {
  kinds: VisualKindView[];
  types: VisualTypeView[];
  limits: VisualLimitsView;
}

/**
 * Cota del panel para la lista de lienzos compuestos.
 *
 * Es una cota **de interfaz** (para no encolar trabajo desmedido al WebView);
 * el kernel vuelve a acotar por su cuenta (`MAX_BLOCKS` por lienzo), de modo
 * que la interfaz nunca es la autoridad del límite.
 */
export const MAX_COMPOSED_CANVASES = 8;

// ─────────────────────────────────────────────────────────────────────────
// Comandos del IPC (constructor visual)
// ─────────────────────────────────────────────────────────────────────────
//
// Las cuatro funciones son puras sobre el texto del lienzo: no tocan la sesión
// del oráculo ni comparten estado con ella.

/** Contrato del lienzo: clases, tipos y cotas, servidos por el kernel. */
export function visualCatalogue(): Promise<VisualCatalogueView> {
  return invoke<VisualCatalogueView>("visual_catalogue");
}

/** Lienzo de ejemplo del kernel, para abrir el editor del panel. */
export function visualSample(): Promise<string> {
  return invoke<string>("visual_sample");
}

/**
 * Traduce, valida y **firma** un lienzo JSON estricto.
 *
 * Rechaza (`Err` legible) si el lienzo incumple el contrato: clave
 * desconocida, tipo fuera del catálogo, aridad que no cuadra o referencia hacia
 * delante. Nunca compila a medias.
 */
export function visualBuild(blueprint: string): Promise<VisualBuildView> {
  return invoke<VisualBuildView>("visual_build", { blueprint });
}

/**
 * Compone varios lienzos en un único ADN firmado.
 *
 * El **orden importa**: la etiqueta firmada es la del primer lienzo con el
 * sufijo `:compuesto` y la raíz de Merkle depende de la secuencia de nodos.
 */
export function visualCompose(blueprints: string[]): Promise<VisualBuildView> {
  return invoke<VisualBuildView>("visual_compose", { blueprints });
}

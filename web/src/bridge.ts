// Puente tipado del kernel → IDE (`bara-ide/src/bridge.rs`, FASE 5).
//
// Cada tipo replica **literalmente** el documento de `bara::ide_bridge`: el
// núcleo lo escribe con claves fijas en *snake_case* y sin pasar por `serde`,
// así que aquí no se renombra ninguna clave — renombrarla sería declarar un
// contrato distinto del que el núcleo firma.
//
// Ninguna decisión ontológica vive aquí: el puente lee la soberanía del kernel
// (identidad, inmunidad, pasarela y runtime) y la publica; la interfaz compara
// el contrato y pinta. No hay umbrales ni veredictos propios: el peligro, el
// veredicto y las marcas son los que calculó la puerta del núcleo.

import { invoke } from "@tauri-apps/api/core";

/** Sección declarada en el manifiesto, con su cota y su origen. */
export interface BridgeSectionSpec {
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

/** El núcleo entrega el puente como texto JSON, no como objeto ya parseado. */
function parseBridge<T>(raw: unknown, what: string): T {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (value === null || typeof value !== "object") {
    throw new Error(`el puente no entregó ${what}`);
  }
  return value as T;
}

/** Contrato del puente: lo que el panel carga una vez y compara después. */
export interface BridgeManifest {
  /** Esquema del documento (`aether-omega/puente/1`). */
  esquema: string;
  /** Versión del kernel que lo emite. */
  version: string;
  /** Dominio ontológico del puente. */
  dominio: string;
  /** Huella del contrato: sólo depende de esquema, orden, cotas y orígenes. */
  huella: string;
  /** Techo de secciones que admite el manifiesto. */
  cota_secciones: number;
  /** Secciones en orden canónico. */
  secciones: BridgeSectionSpec[];
}

/** Sección `identidad`: el contrato embebido en cada instantánea. */
export interface BridgeIdentity {
  /** Dominio ontológico del puente. */
  dominio: string;
  /** El puente no muta el núcleo (invariante de la FASE 5). */
  solo_lectura: boolean;
  /** El puente no escribe en el runtime. */
  muta_nucleo: boolean;
  /** La puerta abierta no rechaza: degrada y marca. */
  rechaza: boolean;
  /** Manifiesto completo, tal como lo firmó el núcleo. */
  manifiesto: BridgeManifest;
}

/** Censo del repertorio inmunitario por clase de anticuerpo. */
export interface BridgeCensus {
  innata: number;
  mucosa: number;
  memoria: number;
  reguladora: number;
  designada: number;
  total: number;
}

/** Contadores acumulados de respuestas del sistema adaptativo. */
export interface BridgeCounters {
  tolerados: number;
  absorbidos: number;
  cuarentenados: number;
  neutralizados: number;
  inmunizados: number;
  expansiones: number;
  recuerdos: number;
  olvidados: number;
  total: number;
}

/** Epitopo reconocido por un anticuerpo del repertorio. */
export interface BridgeEpitope {
  /** Etiqueta legible del patrón. */
  label: string;
  /** Peso con el que la puerta mide el peligro. */
  weight: number;
  /** Digest del patrón. */
  digest: string;
}

/** Estirpe del repertorio adaptativo. */
export interface BridgeAntibody {
  id: number;
  /** Clase canónica (`innata`, `mucosa`, `memoria`, `reguladora`, `designada`). */
  clase: string;
  /** Glifo de la clase (`IgM`, `IgA`, `IgG`, `Treg`…). */
  glifo: string;
  epitopo: BridgeEpitope;
  generacion: number;
  afinidad: number;
  exposiciones: number;
  neutralizaciones: number;
  designado: boolean;
  firma: string;
}

/** Repertorio completo del sistema inmunitario. */
export interface BridgeRepertoire {
  huella: string;
  capacidad: number;
  estirpes: number;
  exposiciones: number;
  olvidos: number;
  afinidad_media: number;
  censo: BridgeCensus;
  anticuerpos: BridgeAntibody[];
}

/** Sección `inmunidad`: la respuesta del sistema adaptativo al documento. */
export interface BridgeImmunity {
  huella: string;
  /** Tolerancia con la que clasifica (0–1). */
  tolerancia: number;
  afinidad_media: number;
  capacidad: number;
  repertorio_lleno: boolean;
  censo: BridgeCensus;
  contadores: BridgeCounters;
  repertorio: BridgeRepertoire;
  /** Acta legible del sistema (la escribe el núcleo). */
  acta: string;
}

/** Censo de veredictos de la puerta abierta. */
export interface BridgeGatewayCensus {
  inocuas: number;
  absorbidas: number;
  neutralizadas: number;
  cuarentena: number;
}

/** Burbuja del rabo de la pasarela, con el veredicto que decidió la puerta. */
export interface BridgeBubble {
  /** Identificador monótono dentro de la pasarela. */
  id: number;
  etiqueta: string;
  /** Origen declarado del transporte (aquí, `ide://editor`). */
  origen: string;
  orden: number;
  /** Holograma de la carga (digest corto). */
  holograma: string;
  bytes: number;
  nodos: number;
  sellados: number;
  /** Veredicto textual del núcleo (`inocuo`, `hostil neutralizado`…). */
  veredicto: string;
  /** Glifo del veredicto. */
  glifo: string;
  /** Peligro medido en milésimas (0–1000). */
  peligro: number;
  /** Marcas que disparó la carga (vacío si es inocua). */
  marcas: string[];
  /** La carga queda sellada: no se propaga al resto del núcleo. */
  estanca: boolean;
  acta: string;
}

/** Sección `pasarela`: la puerta, su censo y el rabo de burbujas. */
export interface BridgeGateway {
  puerta_abierta: boolean;
  rechaza: boolean;
  censo: BridgeGatewayCensus;
  /** Total de burbujas registradas (el rabo sólo muestra las últimas). */
  burbujas: number;
  bytes_inertes: number;
  nodos_sellados: number;
  marcas: number;
  regiones: number;
  memoria: number;
  /** Cota del rabo que publica el panel. */
  cota_rabo: number;
  rabo: BridgeBubble[];
}

/** Cumbre de la pila del runtime. */
export interface BridgeStack {
  profundidad: number;
  /** Etiqueta de la cumbre; `null` si la pila está vacía. */
  cumbre: string | null;
}

/** Certificado ZK del runtime, si el documento llegó a certificarse. */
export interface BridgeCertificate {
  presente: boolean;
  etiqueta: string;
  restricciones: number;
  verificado: boolean;
}

/** Programa Metal‑IR del runtime, si el documento llegó a bajarse a la ISA. */
export interface BridgeMetal {
  presente: boolean;
  etiqueta: string;
  instrucciones: number;
  palabras: number;
}

/** Generación y tamaño del conjunto de axiomas del mutador. */
export interface BridgeAxioms {
  generacion: number;
  total: number;
}

/** Ledger de síntesis y reajuste de masas. */
export interface BridgeEvolution {
  avistamientos: number;
  ledger: number;
  ultimo: string | null;
}

/** Atención acumulada del mutador. */
export interface BridgeAttention {
  total: number;
  cumbre: number;
  prioridad: string | null;
}

/** Embedding simbólico del foco activo. */
export interface BridgeSymbol {
  lanes: number[];
}

/** Correcciones de `⊤∧⊥` ya registradas. */
export interface BridgeCorrection {
  rastros: number;
  sello: number;
  separacion: number;
  anticipa: string | null;
}

/** Diario temporal del runtime. */
export interface BridgeTime {
  instantaneas: number;
  deltas: number;
}

/** Registro cuántico del runtime. */
export interface BridgeQubits {
  vivos: number;
  colapsos: number;
}

/** Malla holográfica del runtime. */
export interface BridgeMesh {
  nodos: number;
  epoca: number;
}

/** Log ontológico del runtime (recuento, nunca descripciones con reloj). */
export interface BridgeLog {
  eventos: number;
  tolerados: number;
  /** Nombre estable del último evento; `null` si no hubo ninguno. */
  ultimo: string | null;
}

/** Sección `nucleo`: el estado soberano que el puente leyó del runtime. */
export interface BridgeKernel {
  pila: BridgeStack;
  memoria: number;
  axiomas: BridgeAxioms;
  evolucion: BridgeEvolution;
  atencion: BridgeAttention;
  simbolo: BridgeSymbol;
  correccion: BridgeCorrection;
  regiones: number;
  tiempo: BridgeTime;
  qubits: BridgeQubits;
  malla: BridgeMesh;
  certificado: BridgeCertificate | null;
  metal: BridgeMetal | null;
  log: BridgeLog;
}

/** Las cuatro secciones canónicas, indexadas por su nombre. */
export interface BridgeSections {
  identidad: BridgeIdentity;
  inmunidad: BridgeImmunity;
  pasarela: BridgeGateway;
  nucleo: BridgeKernel;
}

/** Entrada del catálogo del sobre: qué sección vino y cuánto ocupó. */
export interface BridgeCatalogEntry {
  nombre: string;
  glifo: string;
  orden: number;
  /** ¿La instantánea trae esta sección? */
  presente: boolean;
  bytes: number;
  /** Huella del cuerpo; vacía si la sección no vino. */
  huella: string;
}

/** Instantánea completa del puente (`Snapshot::json`). */
export interface BridgeSnapshot {
  /** Esquema del documento; debe coincidir con el del manifiesto. */
  esquema: string;
  version: string;
  /** Huella de la instantánea: cambia con el estado leído. */
  huella: string;
  /** Huella del manifiesto que el núcleo embebió al capturarla. */
  manifiesto: string;
  /** ¿Están las cuatro secciones canónicas? */
  completa: boolean;
  /** Bytes sumados de las secciones presentadas. */
  bytes: number;
  secciones: BridgeSections;
  catalogo: BridgeCatalogEntry[];
}

// ─────────────────────────────────────────────────────────────────────────
// Comandos del puente
// ─────────────────────────────────────────────────────────────────────────

/** Contrato canónico del puente (`bridge_manifest`): se pide una sola vez. */
export async function bridgeManifest(): Promise<BridgeManifest> {
  const raw = await invoke<string>("bridge_manifest");
  return parseBridge<BridgeManifest>(raw, "el contrato");
}

/** Instantánea de sólo lectura del kernel sobre el documento (`bridge_snapshot`). */
export async function bridgeSnapshot(source: string): Promise<BridgeSnapshot> {
  const raw = await invoke<string>("bridge_snapshot", { source });
  const document = parseBridge<BridgeSnapshot>(raw, "la instantánea");
  if (!document.secciones || !document.catalogo) {
    throw new Error("la instantánea del puente no trae secciones");
  }
  return document;
}

// ─────────────────────────────────────────────────────────────────────────
// Alertas pasivas del contrato
// ─────────────────────────────────────────────────────────────────────────

/**
 * Comprueba que la instantánea **cumple el contrato** que el panel cargó.
 *
 * Sólo mira lo que es contractual: esquema, huella del manifiesto, completitud
 * del sobre, presencia de las secciones del catálogo e invariantes de identidad
 * (sólo lectura, sin mutación, puerta que no rechaza). No interpreta
 * veredictos, no mide peligro y no aplica umbrales: eso lo decide el núcleo y
 * el panel lo pinta tal cual.
 *
 * Devuelve los motivos en orden estable; lista vacía = contrato respetado.
 */
export function bridgeWarnings(
  document: BridgeSnapshot,
  contract: BridgeManifest | null,
): string[] {
  const warnings: string[] = [];
  const ausentes = document.catalogo
    .filter((entrada) => !entrada.presente)
    .map((entrada) => entrada.nombre);

  if (!document.completa) {
    warnings.push(
      ausentes.length > 0
        ? `instantánea incompleta: faltan ${ausentes.join(", ")}`
        : "instantánea incompleta: el sobre no trae las cuatro secciones",
    );
  } else if (ausentes.length > 0) {
    warnings.push(`catálogo con secciones ausentes: ${ausentes.join(", ")}`);
  }

  if (contract === null) {
    warnings.push("contrato del puente sin cargar: no se puede comprobar la deriva");
  } else {
    if (contract.esquema !== document.esquema) {
      warnings.push(
        `deriva de esquema: el panel cargó ${contract.esquema} y el puente emite ${document.esquema}`,
      );
    }
    if (contract.huella !== document.manifiesto) {
      warnings.push(
        `deriva de manifiesto: el panel cargó ${contract.huella} y la instantánea embebió ${document.manifiesto}`,
      );
    }
  }

  const identidad = document.secciones.identidad;
  if (identidad.manifiesto.huella !== document.manifiesto) {
    warnings.push("la identidad embebida no coincide con el manifiesto del sobre");
  }
  if (!identidad.solo_lectura || identidad.muta_nucleo || identidad.rechaza) {
    warnings.push(
      "la identidad no declara un puente de sólo lectura (solo_lectura/muta_nucleo/rechaza)",
    );
  }

  return warnings;
}

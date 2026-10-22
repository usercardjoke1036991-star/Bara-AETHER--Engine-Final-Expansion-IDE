//! # Visual Builder — el lienzo del IDE traducido y **firmado** por el kernel
//!
//! Este módulo **no** traduce nada: proyecta el motor
//! `bara::visual_builder` del núcleo (lienzo JSON estricto → AST *Shoresh* →
//! ADN firmado) a tipos planos que el backend Tauri serializa y el panel React
//! pinta.
//!
//! ## Por qué la clave la pone el IDE y no el usuario
//! [`VISUAL_KEY_SEED`] es una semilla **fija**: el ADN del lienzo es
//! determinista (misma entrada ⇒ misma firma, misma raíz de Merkle), que es la
//! única forma de que el panel pueda *demostrar* la reproducibilidad en vivo.
//! La clave sigue siendo soberana (se deriva con el ángulo áureo del kernel vía
//! `golden_key`), sólo que su entropía es pública y por tanto la firma es un
//! **sello de integridad**, no un secreto: sirve para detectar manipulación
//! posterior, no para autenticar identidades.
//!
//! ## Invariantes
//! 1. **Cero lógica nueva**: aridad, tipos, orden topológico, riesgo, retícula
//!    áurea, verificación del ADN… todo lo decide el kernel; aquí sólo se
//!    *nombra* y se *proyecta*.
//! 2. **Sin `unsafe`, sin `unwrap`/`expect`**: el contrato estricto del lienzo
//!    se convierte en un `Err` legible para la interfaz.
//! 3. **Determinismo**: sin reloj ni aleatoriedad, como el núcleo.
//!
//! ## Limitación declarada
//! El kernel valida con un contrato **estricto de todo o nada** y
//! `parse_blueprint` devuelve `Option`: no publica *qué* etapa falló. El
//! mensaje de error nombra el contrato completo ([`CONTRATO`]) en vez de
//! inventar una causa que esta capa no puede comprobar.

use bara::ast_dna::golden_key;
use bara::ffi_ingest::{BaraType, ShoreshNode};
use bara::visual_builder::{
    self, BlockKind, Blueprint, Cell, Slot, VisualBlock, VisualBuild, VisualReport, MAX_BLOCKS,
    MAX_BLUEPRINT_BYTES, MAX_ID_CHARS, MAX_JSON_DEPTH, MIN_CELL_DISTANCE, SEAL_THRESHOLD,
};

use crate::BelnapPoint;

// ─────────────────────────────────────────────────────────────────────────
// Clave y contrato
// ─────────────────────────────────────────────────────────────────────────

/// Semilla **fija** de la clave soberana con la que el IDE sella el lienzo.
///
/// Pública a propósito: el sello prueba *integridad y reproducibilidad*, no
/// identidad (ver la cabecera del módulo).
pub const VISUAL_KEY_SEED: &[u8] = b"bara-ide:lienzo-visual:v1";

/// Diagnóstico legible cuando el lienzo no respeta el contrato.
pub const CONTRATO: &str = concat!(
    "el lienzo no respeta el contrato estricto del Visual Builder: JSON mal formado, ",
    "claves desconocidas o repetidas, `module`/`id` inválidos, tipo fuera del catálogo, ",
    "aridad que no cuadra con las entradas, referencia hacia delante o riesgo fuera de `[0, 1]`"
);

/// Clave del lienzo: determinista, derivada del ángulo áureo del kernel.
fn clave() -> [u8; 32] {
    golden_key(VISUAL_KEY_SEED)
}

// ─────────────────────────────────────────────────────────────────────────
// Celda de la retícula áurea
// ─────────────────────────────────────────────────────────────────────────

/// Celda de la espiral de Fermat con la que el kernel coloca cada bloque.
///
/// La retícula **no** la calcula la interfaz: sale de `visual_builder::layout`
/// (pétalos `r_k = √k`, `θ_k = k·2π/φ²`), de modo que el lienzo pintado es el
/// reparto de mínima discrepancia que usa la memoria holográfica.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualCellView {
    /// Coordenada `x` en el disco del lienzo (escalada por `√(n−1)`).
    pub x: f64,
    /// Coordenada `y`.
    pub y: f64,
    /// Radio `√k` sin escalar.
    pub radius: f64,
    /// Ángulo `k·2π/φ²`, en radianes.
    pub angle: f64,
}

impl VisualCellView {
    /// Proyecta una celda tal cual la repartió el núcleo.
    fn project(cell: &Cell) -> Self {
        VisualCellView {
            x: cell.x,
            y: cell.y,
            radius: cell.radius,
            angle: cell.angle,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Catálogo del contrato: vocabulario del kernel, sin literales duplicados
// ─────────────────────────────────────────────────────────────────────────

/// Clase de bloque del contrato, con sus dos nombres servidos por el kernel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualKindView {
    /// Nombre canónico (`source`, `transform`, `guard`, `sink`).
    pub name: &'static str,
    /// Etiqueta legible en español.
    pub label: &'static str,
    /// ¿Fuerza el sellado del nodo bajo guarda `שמר`?
    pub forces_seal: bool,
}

/// Tipo del sistema Bara aceptado en `ret` y en las ranuras del lienzo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualTypeView {
    /// Nombre canónico inglés (`number`, `text`, `void`…).
    pub name: &'static str,
    /// Nombre hebreo del kernel.
    pub label: &'static str,
    /// Glifo ASCII del kernel.
    pub glyph: &'static str,
}

/// Cotas del lienzo que impone el kernel (espejo **comprobado** en pruebas).
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualLimitsView {
    /// Bloques máximos por lienzo.
    pub max_blocks: usize,
    /// Bytes máximos del *blueprint*.
    pub max_blueprint_bytes: usize,
    /// Profundidad máxima de anidamiento del JSON.
    pub max_json_depth: usize,
    /// Longitud máxima de un identificador de bloque.
    pub max_id_chars: usize,
    /// Riesgo a partir del cual el nodo nace sellado.
    pub seal_threshold: f64,
    /// Distancia mínima que el kernel exige entre celdas de la retícula.
    pub min_cell_distance: f64,
}

/// Contrato completo del lienzo: clases, tipos y cotas.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualCatalogueView {
    /// Las cuatro clases de bloque.
    pub kinds: Vec<VisualKindView>,
    /// Los siete tipos aceptados.
    pub types: Vec<VisualTypeView>,
    /// Cotas del lienzo.
    pub limits: VisualLimitsView,
}

/// Las cuatro clases del contrato, en orden canónico (el de `BlockKind`).
const KINDS: [BlockKind; 4] = [
    BlockKind::Source,
    BlockKind::Transform,
    BlockKind::Guard,
    BlockKind::Sink,
];

/// Los siete tipos aceptados, en orden canónico.
const TYPES: [BaraType; 7] = [
    BaraType::Number,
    BaraType::Text,
    BaraType::Void,
    BaraType::Truth,
    BaraType::List,
    BaraType::Record,
    BaraType::Unknown,
];

/// Contrato del lienzo tal como lo publica el kernel.
///
/// La interfaz construye sus ayudas con **esto**: si el núcleo añadiera (o
/// renombrara) una clase o un tipo, el panel cambia solo.
pub fn visual_catalogue() -> VisualCatalogueView {
    VisualCatalogueView {
        kinds: KINDS
            .iter()
            .map(|kind| VisualKindView {
                name: kind.name(),
                label: kind.label(),
                forces_seal: kind.forces_seal(),
            })
            .collect(),
        types: TYPES
            .iter()
            .map(|kind| VisualTypeView {
                name: kind.name(),
                label: kind.label(),
                glyph: kind.glyph(),
            })
            .collect(),
        limits: VisualLimitsView {
            max_blocks: MAX_BLOCKS,
            max_blueprint_bytes: MAX_BLUEPRINT_BYTES,
            max_json_depth: MAX_JSON_DEPTH,
            max_id_chars: MAX_ID_CHARS,
            seal_threshold: SEAL_THRESHOLD,
            min_cell_distance: MIN_CELL_DISTANCE,
        },
    }
}

/// Lienzo de ejemplo del kernel, listo para el editor del panel.
pub fn visual_sample() -> String {
    visual_builder::sample_blueprint().to_string()
}

// ─────────────────────────────────────────────────────────────────────────
// Bloques, aristas y nodos del AST
// ─────────────────────────────────────────────────────────────────────────

/// Ranura de entrada de un bloque (struct `Slot` del kernel).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualSlotView {
    /// Índice del bloque productor: **siempre anterior** (grafo acíclico por
    /// construcción, no por comprobación a posteriori).
    pub index: usize,
    /// Tipo canónico declarado en la ranura.
    pub type_name: &'static str,
    /// Nombre hebreo del tipo declarado.
    pub type_label: &'static str,
    /// Glifo ASCII del tipo declarado.
    pub type_glyph: &'static str,
    /// ¿La ranura no declara tipo (`unknown` = comodín de la ingesta)?
    pub wildcard: bool,
}

impl VisualSlotView {
    /// Proyecta una ranura: el tipo lo resolvió el kernel al validar.
    fn project(slot: &Slot) -> Self {
        VisualSlotView {
            index: slot.index,
            type_name: slot.expected.name(),
            type_label: slot.expected.label(),
            type_glyph: slot.expected.glyph(),
            wildcard: slot.expected == BaraType::Unknown,
        }
    }
}

/// Nodo del AST *Shoresh* traducido a partir del lienzo (struct `ShoreshNode`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualNodeView {
    /// Raíz triconsonántica del nodo.
    pub root: String,
    /// Nombre original del bloque en el lienzo.
    pub original: String,
    /// Aridad del nodo.
    pub arity: usize,
    /// Tipo de retorno, nombre canónico.
    pub ret_name: &'static str,
    /// Tipo de retorno, nombre hebreo del kernel.
    pub ret_label: &'static str,
    /// Glifo ASCII del tipo de retorno.
    pub ret_glyph: &'static str,
    /// Riesgo heredado del bloque.
    pub hazard: f64,
    /// ¿Nace sellado bajo guarda `שמר`?
    pub sanitized: bool,
    /// Valencia paraconsistente `(⊤, ⊥)` del nodo, clasificada por el kernel.
    pub valence: BelnapPoint,
}

impl VisualNodeView {
    /// Proyecta un nodo tal cual lo emitió la traducción.
    fn project(node: &ShoreshNode) -> Self {
        VisualNodeView {
            root: node.root.clone(),
            original: node.original.clone(),
            arity: node.arity,
            ret_name: node.ret.name(),
            ret_label: node.ret.label(),
            ret_glyph: node.ret.glyph(),
            hazard: node.hazard,
            sanitized: node.sanitized,
            valence: BelnapPoint::project(&node.valence),
        }
    }
}

/// Bloque del lienzo proyectado, con su celda de retícula y su valencia.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualBlockView {
    /// Identificador declarado en el lienzo.
    pub id: String,
    /// Nombre visible del bloque.
    pub name: String,
    /// Clase canónica (`source`, `transform`, `guard`, `sink`).
    pub kind: &'static str,
    /// Etiqueta legible de la clase.
    pub kind_label: &'static str,
    /// Aridad declarada (igual al número de entradas).
    pub arity: usize,
    /// Tipo de retorno, nombre canónico.
    pub ret_name: &'static str,
    /// Tipo de retorno, nombre hebreo del kernel.
    pub ret_label: &'static str,
    /// Glifo ASCII del tipo de retorno.
    pub ret_glyph: &'static str,
    /// Riesgo declarado en `[0, 1]`.
    pub hazard: f64,
    /// Raíz triconsonántica del nodo.
    pub root: String,
    /// ¿El nodo nace sellado?
    pub sanitized: bool,
    /// Ranuras de entrada, en orden.
    pub inputs: Vec<VisualSlotView>,
    /// Celda de la retícula áurea (`layout` del kernel); `null` si el informe
    /// no la publicó, que sólo ocurre ante una incoherencia interna.
    pub cell: Option<VisualCellView>,
    /// Valencia del nodo *Shoresh* correspondiente; `null` si la traducción no
    /// emitió nodo para este bloque (incoherencia interna, nunca un valor
    /// inventado).
    pub valence: Option<BelnapPoint>,
}

// ─────────────────────────────────────────────────────────────────────────
// Informe de validación
// ─────────────────────────────────────────────────────────────────────────

/// Comprobación del informe, tal como la nombró el kernel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualCheckView {
    /// Nombre corto de la comprobación.
    pub name: &'static str,
    /// ¿Se superó?
    pub passed: bool,
}

/// Informe de validación y traducción del lienzo (`VisualReport` del kernel).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualReportView {
    /// Bloques traducidos.
    pub blocks: usize,
    /// Aristas del grafo (suma de entradas).
    pub edges: usize,
    /// Profundidad del camino más largo, en bloques encadenados.
    pub depth: usize,
    /// Riesgo medio.
    pub hazard_mean: f64,
    /// Riesgo máximo.
    pub hazard_max: f64,
    /// **Cota áurea del peor caso**: `máximo + (máximo − mínimo)/φ`, saturada a
    /// `1`; siempre `≥` el máximo y siempre dentro del rango.
    pub hazard_bound: f64,
    /// Nodos que nacen sellados bajo guarda.
    pub sealed: usize,
    /// Orden topológico (índices de bloque); el kernel garantiza que es el
    /// orden natural de los índices.
    pub order: Vec<usize>,
    /// Retícula de colocación, en orden de bloque.
    pub cells: Vec<VisualCellView>,
    /// Distancia mínima medida entre celdas.
    pub min_distance: f64,
    /// Radio máximo de la retícula.
    pub radius: f64,
    /// Comprobaciones del kernel, con su veredicto.
    pub checks: Vec<VisualCheckView>,
    /// Veredicto legible del kernel.
    pub verdict: String,
    /// ¿El ADN del AST quedó verificado?
    pub verified: bool,
    /// Raíz de Merkle del ADN, en hexadecimal.
    pub root_hex: String,
    /// Firma soberana del ADN, en hexadecimal.
    pub signature_hex: String,
    /// Identificador público de la clave firmante.
    pub key_id: u64,
}

impl VisualReportView {
    /// Proyecta el informe sin reinterpretar ningún número.
    fn project(report: &VisualReport) -> Self {
        VisualReportView {
            blocks: report.blocks,
            edges: report.edges,
            depth: report.depth,
            hazard_mean: report.hazard_mean,
            hazard_max: report.hazard_max,
            hazard_bound: report.hazard_bound,
            sealed: report.sealed,
            order: report.order.clone(),
            cells: report.cells.iter().map(VisualCellView::project).collect(),
            min_distance: report.min_distance,
            radius: report.radius,
            checks: report
                .checks
                .iter()
                .map(|check| VisualCheckView {
                    name: check.name,
                    passed: check.passed,
                })
                .collect(),
            verdict: report.verdict.clone(),
            verified: report.verified,
            root_hex: report.root_hex.clone(),
            signature_hex: report.signature_hex.clone(),
            key_id: report.key_id,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Resultado completo y traducción
// ─────────────────────────────────────────────────────────────────────────

/// Resultado completo de traducir un lienzo: AST, sello y programa *Shoresh*.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualBuildView {
    /// Nombre del módulo.
    pub module: String,
    /// Etiqueta firmada: viaja **dentro** del ADN (cambiarla cambia la firma).
    pub label: String,
    /// Programa *Shoresh* traducido, listo para conversar con el oráculo.
    pub source: String,
    /// AST *Shoresh* completo; en una composición, **todos** los nodos.
    pub ast: Vec<VisualNodeView>,
    /// Bloques del lienzo proyectado; en una composición, los del **primer**
    /// lienzo, que es el que aporta la etiqueta que firma el conjunto.
    pub blocks: Vec<VisualBlockView>,
    /// Informe de validación; en una composición, el del conjunto compuesto.
    pub report: VisualReportView,
}

/// Proyecta un bloque con su celda áurea y la valencia de su nodo homólogo.
fn block_view(block: &VisualBlock, index: usize, build: &VisualBuild) -> VisualBlockView {
    VisualBlockView {
        id: block.id.clone(),
        name: block.name.clone(),
        kind: block.kind.name(),
        kind_label: block.kind.label(),
        arity: block.arity,
        ret_name: block.ret.name(),
        ret_label: block.ret.label(),
        ret_glyph: block.ret.glyph(),
        hazard: block.hazard,
        root: block.root.clone(),
        sanitized: block.sanitized,
        inputs: block.inputs.iter().map(VisualSlotView::project).collect(),
        cell: build.report.cells.get(index).map(VisualCellView::project),
        valence: build
            .ast
            .nodes
            .get(index)
            .map(|node| BelnapPoint::project(&node.valence)),
    }
}

/// Proyecta el *blueprint* validado junto con su traducción firmada.
fn project(blueprint: &Blueprint, build: &VisualBuild) -> VisualBuildView {
    VisualBuildView {
        module: build.module.clone(),
        label: build.label.clone(),
        source: build.source.clone(),
        ast: build
            .ast
            .nodes
            .iter()
            .map(VisualNodeView::project)
            .collect(),
        blocks: blueprint
            .blocks
            .iter()
            .enumerate()
            .map(|(index, block)| block_view(block, index, build))
            .collect(),
        report: VisualReportView::project(&build.report),
    }
}

/// Causa legible del rechazo (el kernel decide; aquí sólo se traduce a texto).
fn contrato() -> String {
    CONTRATO.to_string()
}

/// Traduce, valida y **firma** un lienzo JSON estricto.
///
/// El lienzo se parsea dos veces con la misma función del kernel (una para
/// publicar los bloques tal como se declararon, otra para obtener el AST y el
/// ADN): ambas lecturas son deterministas, así que no hay ventana en la que el
/// resultado pueda diferir.
pub fn visual_build(json: &str) -> Result<VisualBuildView, String> {
    let blueprint = visual_builder::parse_blueprint(json).ok_or_else(contrato)?;
    let build = visual_builder::build(json, &clave()).ok_or_else(contrato)?;
    Ok(project(&blueprint, &build))
}

/// Compone varios lienzos en un único ADN firmado (`ShoreshAst::graft`).
///
/// La composición **depende del orden**: la etiqueta firmada es la del primer
/// lienzo con el sufijo `:compuesto` y la raíz de Merkle se calcula sobre la
/// secuencia de nodos resultante.
pub fn visual_compose(lienzos: &[String]) -> Result<VisualBuildView, String> {
    let first = lienzos
        .first()
        .ok_or_else(|| "no hay lienzos que componer".to_string())?;
    let blueprint = visual_builder::parse_blueprint(first).ok_or_else(contrato)?;
    let refs: Vec<&str> = lienzos.iter().map(|text| text.as_str()).collect();
    let build = visual_builder::build_composed(&refs, &clave()).ok_or_else(contrato)?;
    Ok(project(&blueprint, &build))
}

/// Documento `.bara` que el kernel acepta emitir: programa y sello juntos.
///
/// No sale de `visual_build` cacheado en la interfaz. Se reconstruye en Rust
/// y sólo existe si el ADN vuelve a verificar.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct VisualEmission {
    /// Programa *Shoresh* listo para el editor.
    pub source: String,
    /// Etiqueta que viaja dentro del ADN.
    pub label: String,
    /// Raíz de Merkle, hexadecimal.
    pub root_hex: String,
    /// Firma HMAC del ADN, hexadecimal.
    pub signature_hex: String,
}

/// Traduce el lienzo otra vez y niega la emisión si el sello no verifica.
pub fn visual_emit(json: &str) -> Result<VisualEmission, String> {
    release(visual_build(json)?)
}

/// Igual que [`visual_emit`], sobre la composición ordenada de varios lienzos.
pub fn visual_emit_composed(lienzos: &[String]) -> Result<VisualEmission, String> {
    release(visual_compose(lienzos)?)
}

/// La emisión exige verificación, raíz y firma de 32 bytes (64 hex).
fn release(view: VisualBuildView) -> Result<VisualEmission, String> {
    if !view.report.verified {
        return Err("el ADN no verifica: el documento .bara no se emite".to_string());
    }
    if view.report.root_hex.len() != 64 || view.report.signature_hex.len() != 64 {
        return Err("el sello está incompleto: el documento .bara no se emite".to_string());
    }
    if view.source.trim().is_empty() {
        return Err("el kernel no produjo programa Shoresh".to_string());
    }
    Ok(VisualEmission {
        source: view.source,
        label: view.label,
        root_hex: view.report.root_hex,
        signature_hex: view.report.signature_hex,
    })
}

// ─────────────────────────────────────────────────────────────────────────
// Pruebas: contrato del lienzo, sello determinista y contrato del IPC
// ─────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use bara::visual_builder::bara_type_from_name;

    /// Lienzo mínimo escrito a mano: una fuente y un sumidero encadenados.
    const MINIMO: &str = r#"{ "module": "m", "label": "minimo", "blocks": [
        { "id": "a", "name": "uno", "kind": "source", "arity": 0,
          "ret": "number", "hazard": 0.0 },
        { "id": "b", "name": "dos", "kind": "sink", "arity": 1, "ret": "void",
          "hazard": 0.25, "inputs": [{ "index": 0, "type": "number" }] } ] }"#;

    #[test]
    fn el_lienzo_de_ejemplo_se_traduce_y_se_firma() {
        let lienzo = visual_build(&visual_sample()).expect("el ejemplo del kernel es válido");

        assert_eq!(lienzo.module, "lienzo_genesis");
        assert_eq!(lienzo.label, "lienzo-genesis");
        assert_eq!(lienzo.blocks.len(), 5);
        assert_eq!(lienzo.ast.len(), 5);
        assert_eq!(lienzo.report.blocks, 5);
        assert_eq!(lienzo.report.edges, 4);
        assert_eq!(lienzo.report.depth, 4);
        assert_eq!(lienzo.report.sealed, 1, "la guarda sella; el riesgo no");

        // Clases y ranuras tal como se declararon en el lienzo.
        assert_eq!(lienzo.blocks[0].kind, "source");
        assert_eq!(lienzo.blocks[2].kind, "transform");
        assert_eq!(lienzo.blocks[3].kind_label, "guarda");
        assert_eq!(lienzo.blocks[4].kind_label, "sumidero");
        assert_eq!(lienzo.blocks[2].inputs.len(), 2);
        assert!(!lienzo.blocks[2].inputs[0].wildcard, "número declarado");
        assert!(lienzo.blocks[2].inputs[1].wildcard, "ranura sin tipo");
        assert_eq!(lienzo.blocks[4].inputs[0].index, 3);
        assert_eq!(lienzo.blocks[4].ret_glyph, "∅", "el sumidero no retorna");
        assert!(lienzo.blocks[3].sanitized);
        assert!(!lienzo.blocks[0].sanitized);

        // La retícula y la valencia las decidió el kernel, no esta capa.
        assert_eq!(lienzo.report.cells.len(), 5);
        assert!(lienzo.blocks.iter().all(|block| block.cell.is_some()));
        assert!(lienzo.blocks.iter().all(|block| block.valence.is_some()));
        assert!(lienzo.report.min_distance > 0.0);
        assert!(lienzo.report.min_distance.is_finite());
        assert!(lienzo.report.radius > 0.0);

        // Riesgo: media ≤ máximo ≤ cota áurea ≤ 1.
        assert!(lienzo.report.hazard_mean < lienzo.report.hazard_max);
        assert!(lienzo.report.hazard_bound >= lienzo.report.hazard_max);
        assert!(lienzo.report.hazard_bound <= 1.0);

        // Sello: el ADN se verifica con la clave del IDE y publica la firma.
        assert!(lienzo.report.verified);
        assert_eq!(lienzo.report.root_hex.len(), 64);
        assert_eq!(lienzo.report.signature_hex.len(), 64);
        assert_ne!(lienzo.report.key_id, 0);
        assert!(lienzo.report.checks.iter().all(|check| check.passed));
        assert!(!lienzo.source.is_empty());
    }

    #[test]
    fn el_sello_es_determinista_y_el_lienzo_invalido_se_rechaza() {
        assert_eq!(
            visual_build(&visual_sample()),
            visual_build(&visual_sample()),
            "misma entrada, misma firma (sin reloj ni azar)"
        );

        // Una clave desconocida invalida el lienzo entero (contrato estricto).
        let roto = r#"{ "module": "m", "blocks": [ { "id": "a", "name": "uno",
            "kind": "source", "arity": 0, "ret": "number", "hazard": 0.0,
            "hazard_extra": 1 } ] }"#;
        let error = visual_build(roto).expect_err("clave desconocida");
        assert_eq!(error, CONTRATO);
        assert!(visual_build("").is_err(), "JSON vacío");
        assert!(visual_build("null").is_err(), "raíz que no es objeto");
        assert!(
            visual_compose(&[]).is_err(),
            "sin lienzos no hay composición"
        );
    }

    #[test]
    fn la_composicion_depende_del_orden_y_suma_los_nodos() {
        let doble = visual_compose(&[visual_sample(), visual_sample()]).expect("compone");
        assert_eq!(doble.label, "lienzo-genesis:compuesto");
        assert_eq!(doble.module, "lienzo_genesis");
        assert_eq!(doble.ast.len(), 10, "los AST se injertan en orden");
        assert_eq!(doble.report.blocks, 10);
        assert_eq!(
            doble.blocks.len(),
            5,
            "los bloques son los del primer lienzo"
        );
        assert!(doble.report.verified);

        let directo =
            visual_compose(&[visual_sample(), MINIMO.to_string()]).expect("compone en orden");
        let espejo =
            visual_compose(&[MINIMO.to_string(), visual_sample()]).expect("compone invertido");
        assert_eq!(directo.report.blocks, 7);
        assert_eq!(directo.label, "lienzo-genesis:compuesto");
        assert_eq!(espejo.label, "minimo:compuesto");
        assert_ne!(
            directo.report.root_hex, espejo.report.root_hex,
            "la raíz de Merkle depende del orden"
        );
    }

    #[test]
    fn el_catalogo_sirve_el_vocabulario_del_nucleo() {
        let catalogo = visual_catalogue();
        assert_eq!(catalogo.kinds.len(), 4);
        assert_eq!(catalogo.kinds[0].name, "source");
        assert_eq!(catalogo.kinds[3].name, "sink");
        assert!(catalogo.kinds[2].forces_seal, "la guarda sella siempre");
        assert!(!catalogo.kinds[0].forces_seal);

        assert_eq!(catalogo.types.len(), 7);
        assert_eq!(catalogo.types[6].name, "unknown");
        for tipo in &catalogo.types {
            assert!(!tipo.label.is_empty() && !tipo.glyph.is_empty());
            assert_eq!(
                bara_type_from_name(tipo.name).map(|kind| kind.name()),
                Some(tipo.name),
                "el nombre canónico tiene inverso exacto"
            );
        }
        for clase in &catalogo.kinds {
            assert_eq!(
                BlockKind::from_name(clase.name).map(|kind| kind.name()),
                Some(clase.name)
            );
        }

        // Las cotas son las del kernel, no una copia a mano.
        assert_eq!(catalogo.limits.max_blocks, MAX_BLOCKS);
        assert_eq!(catalogo.limits.max_blueprint_bytes, MAX_BLUEPRINT_BYTES);
        assert_eq!(catalogo.limits.max_json_depth, MAX_JSON_DEPTH);
        assert_eq!(catalogo.limits.max_id_chars, MAX_ID_CHARS);
        assert_eq!(catalogo.limits.seal_threshold, SEAL_THRESHOLD);
        assert_eq!(catalogo.limits.min_cell_distance, MIN_CELL_DISTANCE);
    }

    /// Contrato IPC: el JSON que el backend devuelve usa exactamente las claves
    /// que declara `web/src/visual.ts` (camelCase, sin listas desnudas).
    #[cfg(feature = "serde")]
    #[test]
    fn el_contrato_ipc_usa_las_claves_de_visual_ts() {
        let lienzo = visual_build(&visual_sample()).expect("válido");
        let json = serde_json::to_value(&lienzo).expect("el lienzo debe serializar");
        assert!(json["module"].is_string());
        assert!(json["label"].is_string());
        assert!(json["source"].is_string());
        assert_eq!(json["blocks"][0]["kind"], "source");
        assert_eq!(json["blocks"][0]["kindLabel"], "fuente");
        assert_eq!(json["blocks"][0]["retName"], "number");
        assert!(json["blocks"][0]["inputs"].is_array());
        assert!(json["blocks"][0]["cell"]["x"].is_number());
        assert!(json["blocks"][0]["cell"]["angle"].is_number());
        assert!(json["blocks"][0]["valence"]["key"].is_string());
        assert_eq!(json["blocks"][0]["valence"]["key"], "true");
        assert!(json["ast"][0]["original"].is_string());
        assert!(json["ast"][0]["valence"]["observation"]["glyph"].is_string());
        assert_eq!(json["report"]["blocks"], 5);
        assert!(json["report"]["hazardMean"].is_number());
        assert!(json["report"]["hazardBound"].is_number());
        assert!(json["report"]["minDistance"].is_number());
        assert!(json["report"]["order"].is_array());
        assert!(json["report"]["checks"][0]["name"].is_string());
        assert!(json["report"]["checks"][0]["passed"].is_boolean());
        assert!(json["report"]["verified"].is_boolean());
        assert!(json["report"]["rootHex"].is_string());
        assert!(json["report"]["signatureHex"].is_string());
        assert!(json["report"]["keyId"].is_number());

        let catalogo = serde_json::to_value(visual_catalogue()).expect("catálogo serializa");
        assert_eq!(catalogo["kinds"][0]["name"], "source");
        assert_eq!(catalogo["kinds"][0]["forcesSeal"], false);
        assert_eq!(catalogo["types"][6]["name"], "unknown");
        assert_eq!(catalogo["limits"]["maxBlocks"], MAX_BLOCKS);
        assert_eq!(catalogo["limits"]["sealThreshold"], SEAL_THRESHOLD);
        assert!(serde_json::to_value(visual_sample()).is_ok());
    }

    #[test]
    fn no_se_emite_un_bara_sin_sello_verificado() {
        let emitido = visual_emit(&visual_sample()).expect("el ejemplo firma");
        assert!(!emitido.source.is_empty());
        assert_eq!(emitido.root_hex.len(), 64);
        assert_eq!(emitido.signature_hex.len(), 64);
        assert!(visual_emit("{").is_err(), "JSON roto no emite");
        assert!(visual_emit("").is_err(), "vacío no emite");
        let compuesto = visual_emit_composed(&[visual_sample(), MINIMO.to_string()])
            .expect("la composición firma");
        assert!(compuesto.label.contains("compuesto") || !compuesto.source.is_empty());
        assert_eq!(compuesto.signature_hex.len(), 64);
    }
}

//! # Telemetría del kernel para el Cockpit de escritorio (AETHER‑Ω)
//!
//! Capa **de sólo proyección** entre el kernel congelado `bara` y la ventana
//! Tauri v2. No reimplementa lógica: llama a los módulos públicos del núcleo y
//! devuelve el JSON que ellos firman.
//!
//! ## Contrato de los cuatro comandos
//! * [`system_manifest`] — `bara::ide_bridge::Manifest::canon` + sección
//!   `identidad` + [`bara::neural_bridge::IDENTITY_FINGERPRINT`].
//! * [`neural_frame`] — `NeuralFrame::json()` con inferencia, censo de Belnap,
//!   memoria a largo plazo y vista semántica *Shoresh* (`NeuralIT`).
//! * [`flight_recorder_logs`] — volcado **de sólo lectura** de la caja negra
//!   (`flight_recorder::inspect`), sin tocar el anillo estático.
//! * [`transmute_input`] — pasarela universal: transmuta, audita, indexa en
//!   `NeuralIT`, alimenta la memoria y publica el dictamen tetravalente.
//!
//! ## Invariantes
//! 1. **Cero `unsafe`** (`#![forbid(unsafe_code)]`).
//! 2. **Totalidad**: ninguna entrada provoca un pánico. [`guarded`] contiene
//!    cualquier *unwind* que escape del backend y lo convierte en `Err(String)`
//!    para que el proceso de UI siga vivo.
//! 3. **Determinismo**: el estado cognitivo sólo cambia con una transmutación
//!    admitida; el resto de comandos son lecturas puras o proyecciones.
//! 4. **Sin estado compartido fuera del cerrojo**: el índice, la memoria y la
//!    generación viven en [`CognitiveState`], protegido por un `Mutex`.

#![forbid(unsafe_code)]

use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, MutexGuard};

use bara::autopoiesis::PurposeContract;
use bara::autopoietic::BelnapValue;
use bara::ffi_ingest::ShoreshAst;
use bara::flight_recorder;
use bara::ide_bridge::{section_identity, Manifest};
use bara::inference::{InferenceEngine, InferenceReport, RuleKind};
use bara::long_term_memory::LongTermMemory;
use bara::neural_bridge::{NeuralFrame, IDENTITY_FINGERPRINT};
use bara::neural_it::{NeuralIt, SyncReport};
use bara::transmuter::{transmute, Transmutation};
use serde_json::{json, Value};

/// Fragmento canónico de demostración. Se usa para sembrar el Cockpit la
/// primera vez que se pide un marco cognitivo; también lo publica el manifiesto
/// para que el editor de la UI arranque con el mismo texto.
pub const DEMO_SOURCE: &str = "fn main() {\n    let identidad = verdadero;\n    if identidad { return 0; }\n}\n";

/// Estado cognitivo de la ventana: índice *Shoresh*, memoria y última foto.
///
/// El estado es **local a la ventana** (Tauri lo gestiona con
/// `manage(Mutex::new(CognitiveState::new()))`): dos ventanas no comparten
/// cognición, aunque sí el Flight Recorder global —que es un anillo estático
/// deliberadamente compartido—.
pub struct CognitiveState {
    engine: NeuralIt,
    memory: LongTermMemory,
    last_ast: Option<ShoreshAst>,
    last_report: Option<InferenceReport>,
    generation: u64,
}

impl CognitiveState {
    /// Estado virgen; la semilla se aplica perezosamente en [`Self::ensure_seeded`].
    pub fn new() -> Self {
        Self {
            engine: NeuralIt::new(),
            memory: LongTermMemory::new(),
            last_ast: None,
            last_report: None,
            generation: 0,
        }
    }

    /// Siembra el estado con [`DEMO_SOURCE`] una sola vez.
    ///
    /// Es best-effort: si la semilla no fuese admisible, el Cockpit sigue
    /// mostrando un marco vacío coherente en lugar de impedir el arranque.
    fn ensure_seeded(&mut self) {
        if self.last_ast.is_none() {
            let _ = self.apply(DEMO_SOURCE);
        }
    }

    /// Transmuta, audita e indexa un fragmento; devuelve el informe JSON.
    ///
    /// La mutación es **atómica**: el índice sólo se publica si
    /// `NeuralIt::synchronize_with` termina bien; si el contrato o la auditoría
    /// rechazan el AST, el estado anterior queda intacto.
    fn apply(&mut self, source: &str) -> String {
        let transmutation = transmute(source);
        let mut admitted = false;
        let mut sync = Value::Null;
        let mut reason = Value::Null;
        let mut memory_ingested = 0usize;
        let mut memory_omitted = 0usize;

        if transmutation.is_admissible() {
            let contract = PurposeContract::new("bara-ide/cockpit");
            match self
                .engine
                .synchronize_with(&transmutation.ast, &contract, None)
            {
                Ok(report) => {
                    admitted = true;
                    sync = sync_json(report);
                    for node in &transmutation.ast.nodes {
                        match self.memory.ingest(node, 0) {
                            Ok(_) => memory_ingested = memory_ingested.saturating_add(1),
                            Err(_) => memory_omitted = memory_omitted.saturating_add(1),
                        }
                    }
                    self.last_ast = Some(transmutation.ast.clone());
                    self.last_report = Some(infer(&transmutation.ast));
                    self.generation = self.generation.saturating_add(1);
                }
                Err(error) => reason = Value::String(error.to_string()),
            }
        } else if transmutation.ast.nodes.is_empty() {
            reason = Value::String("el fragmento no aporta ningún nodo".to_string());
        } else {
            reason = Value::String(format!(
                "auditoría estática {}/{}: el AST no se fusiona",
                transmutation.report.audit_passed_rules, transmutation.report.audit_total_rules
            ));
        }

        transmutation_json(
            &transmutation,
            admitted,
            sync,
            reason,
            memory_ingested,
            memory_omitted,
        )
    }
}

impl Default for CognitiveState {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Comandos (implementación pura, testeable sin ventana)
// ─────────────────────────────────────────────────────────────────────────

/// Manifiesto ontológico + huella de identidad del puente.
pub fn system_manifest() -> Result<String, String> {
    let manifest = Manifest::canon();
    let identity = section_identity().map_err(|error| error.to_string())?;
    let sections: Vec<Value> = manifest
        .sections()
        .iter()
        .map(|spec| {
            json!({
                "nombre": spec.kind.name(),
                "glifo": spec.kind.glyph(),
                "orden": spec.kind.index(),
                "cota_bytes": spec.limit,
                "origen": spec.source,
            })
        })
        .collect();

    Ok(json!({
        "esquema": bara::ide_bridge::BRIDGE_SCHEMA,
        "version": bara::ide_bridge::BRIDGE_VERSION,
        "dominio": "bara:aether-omega:puente:v1",
        "huella_identidad": IDENTITY_FINGERPRINT,
        "huella_manifiesto": manifest.fingerprint(),
        "manifiesto": parse_or_raw(&manifest.json()),
        "identidad": parse_or_raw(identity.body()),
        "secciones": sections,
        "demo": DEMO_SOURCE,
    })
    .to_string())
}

/// Marco cognitivo completo (`NeuralFrame::json`).
///
/// La primera llamada siembra el índice con [`DEMO_SOURCE`]; las siguientes
/// reflejan la última transmutación admitida.
pub fn neural_frame(state: &Mutex<CognitiveState>) -> Result<String, String> {
    let mut state = lock(state)?;
    state.ensure_seeded();
    let report = match state.last_report {
        Some(report) => report,
        None => match state.last_ast.as_ref() {
            Some(ast) => infer(ast),
            None => InferenceEngine::new().evaluate(),
        },
    };
    let frame =
        NeuralFrame::capture(state.generation, report, &state.memory).with_semantic(&state.engine);
    Ok(frame.json())
}

/// Volcado de sólo lectura de la caja negra.
pub fn flight_recorder_logs() -> Result<String, String> {
    let inspection = flight_recorder::inspect();
    let counters = inspection.counters;
    let entries: Vec<Value> = inspection
        .entries
        .iter()
        .map(|entry| {
            json!({
                "secuencia": entry.sequence,
                "marca": entry.timestamp,
                "clase": entry.event.label(),
                "glifo": entry.event.glyph(),
                "codigo_clase": entry.event.code(),
                "violacion": entry.violation.label(),
                "codigo_violacion": entry.violation.code(),
                "huella": entry.hex(),
                "conflicto": entry.is_conflict(),
            })
        })
        .collect();

    Ok(json!({
        "contadores": {
            "capacidad": counters.capacity,
            "reservadas": counters.reserved,
            "publicadas": counters.published,
            "sobrescritas": counters.overwritten,
            "en_vuelo": counters.in_flight,
            "ocupadas": counters.occupied(),
            "llena": counters.is_full(),
        },
        "omitidas": inspection.skipped,
        "entradas": entries,
        "texto": flight_recorder::render(),
    })
    .to_string())
}

/// Transmuta una entrada externa y actualiza la cognición si es admisible.
pub fn transmute_input(state: &Mutex<CognitiveState>, source: &str) -> Result<String, String> {
    let mut state = lock(state)?;
    Ok(state.apply(source))
}

// ─────────────────────────────────────────────────────────────────────────
// Contención de pánicos y cerrojos
// ─────────────────────────────────────────────────────────────────────────

/// Ejecuta una operación del backend y convierte cualquier *unwind* en `Err`.
///
/// El kernel es total por diseño; esta guarda es la segunda línea de defensa
/// para que un fallo inesperado de la capa glue no derribe el proceso de la UI.
pub fn guarded<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(result) => result,
        Err(payload) => Err(format!(
            "pánico contenido en el backend: {}",
            panic_text(payload.as_ref())
        )),
    }
}

fn panic_text(payload: &(dyn Any + Send)) -> &str {
    if let Some(text) = payload.downcast_ref::<&str>() {
        text
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.as_str()
    } else {
        "causa desconocida"
    }
}

fn lock(state: &Mutex<CognitiveState>) -> Result<MutexGuard<'_, CognitiveState>, String> {
    state
        .lock()
        .map_err(|_| "estado cognitivo no disponible (cerrojo envenenado)".to_string())
}

fn parse_or_raw(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
}

// ─────────────────────────────────────────────────────────────────────────
// Inferencia y serialización
// ─────────────────────────────────────────────────────────────────────────

/// Evalúa el AST transmutado con el motor de inferencia tetravalente.
///
/// Cada raíz del AST es un hecho de capa 0. Se añade una única conclusión de
/// capa 1 (`סינתזה`, «síntesis») que recibe la unión de todos los hechos: así
/// el marco muestra reglas realmente aplicadas y, si dos hechos se contradicen,
/// la contradicción `⊤∧⊥` se conserva sin explosión.
fn infer(ast: &ShoreshAst) -> InferenceReport {
    let mut engine = InferenceEngine::new();
    let mut facts = Vec::new();
    for node in &ast.nodes {
        let before = engine.node_count();
        let value = BelnapValue::from_state(&node.valence);
        if let Ok(id) = engine.assert(0, node.root.as_str(), value) {
            if engine.node_count() > before && !facts.contains(&id) {
                facts.push(id);
            }
        }
    }
    if let Ok(synthesis) = engine.assert(1, "סינתזה", BelnapValue::Neither) {
        for fact in facts {
            let _ = engine.add_rule(
                fact,
                synthesis,
                RuleKind::Transfer,
                BelnapValue::True,
                None,
            );
        }
    }
    engine.evaluate()
}

fn sync_json(report: SyncReport) -> Value {
    json!({
        "proposito": report.purpose,
        "indice": {
            "nodos": report.index.nodes,
            "indexadas": report.index.indexed,
            "fusionadas": report.index.merged,
            "ranuras": report.index.slots,
            "capacidad": report.index.capacity,
            "huella": report.index.fingerprint(),
            "coherente": report.index.is_coherent(),
        },
        "auditoria": {
            "superadas": report.audit_passed,
            "totales": report.audit_total,
            "conforme": report.audit_passed == report.audit_total && report.audit_total > 0,
        },
        "contradicciones": report.contradictions,
        "indeterminados": report.unknown,
        "billete": report.ticket,
        "coherente": report.is_coherent(),
    })
}

fn transmutation_json(
    transmutation: &Transmutation,
    admitted: bool,
    sync: Value,
    reason: Value,
    memory_ingested: usize,
    memory_omitted: usize,
) -> String {
    let report = &transmutation.report;
    let ast: Vec<Value> = transmutation
        .ast
        .nodes
        .iter()
        .map(|node| {
            let value = BelnapValue::from_state(&node.valence);
            json!({
                "raiz": node.root.as_str(),
                "original": node.original.as_str(),
                "aridad": node.arity,
                "tipo": node.ret.name(),
                "tipo_glifo": node.ret.glyph(),
                "riesgo": node.hazard,
                "valencia": value.glyph(),
                "valencia_nombre": value.name(),
                "valencia_indice": value.index(),
                "sellado": node.sanitized,
            })
        })
        .collect();

    json!({
        "admisible": admitted,
        "lenguaje": {
            "tag": report.language.tag(),
            "nombre": report.language.label(),
        },
        "informe": {
            "sentencias": report.statements,
            "aceptadas": report.accepted,
            "rechazadas": report.rejected,
            "cuarentena": report.quarantined,
            "verdadero": report.true_count,
            "falso": report.false_count,
            "ambos": report.both,
            "ninguno": report.neither,
            "sellados": report.sealed,
            "truncado": report.truncated,
            "lossy": report.lossy,
            "auditoria_ok": report.audit_passed,
            "reglas_superadas": report.audit_passed_rules,
            "reglas_totales": report.audit_total_rules,
        },
        "ast": ast,
        "sincronizacion": sync,
        "memoria": {
            "ingeridas": memory_ingested,
            "omitidas": memory_omitted,
        },
        "motivo": reason,
    })
    .to_string()
}

// ─────────────────────────────────────────────────────────────────────────
// Pruebas (sin ventana: el estado y los comandos son puros)
// ─────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Cerrojo de pruebas: el Flight Recorder es un anillo **global y estático**,
    /// así que una transmutación concurrente añadiría eventos entre dos lecturas
    /// y rompería el test de sólo-lectura. Serializar el módulo hace determinista
    /// el contador sin tocar el estado de producción.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn serialized() -> MutexGuard<'static, ()> {
        TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn parsed(raw: &str) -> Value {
        serde_json::from_str(raw).unwrap_or(Value::Null)
    }

    #[test]
    fn el_manifiesto_publica_identidad_y_cuatro_secciones() {
        let _serial = serialized();
        let document = parsed(&system_manifest().unwrap_or_default());
        assert_eq!(document["huella_identidad"], IDENTITY_FINGERPRINT);
        assert_eq!(document["esquema"], bara::ide_bridge::BRIDGE_SCHEMA);
        let sections = document["secciones"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        assert_eq!(sections.len(), 4);
        assert_eq!(sections[0]["nombre"], "identidad");
        assert_eq!(sections[3]["nombre"], "nucleo");
        assert!(!document["demo"].as_str().unwrap_or_default().is_empty());
    }

    #[test]
    fn el_marco_sembrado_es_coherente_y_expone_la_semantica() {
        let _serial = serialized();
        let state = Mutex::new(CognitiveState::new());
        let document = parsed(&neural_frame(&state).unwrap_or_default());
        assert_eq!(document["coherente"], true);
        assert!(document["inferencia"]["nodos"].as_u64().unwrap_or_default() > 0);
        assert!(document["memoria"]["entradas"].as_u64().unwrap_or_default() > 0);
        assert!(document["semantica"]["ranuras"].as_u64().unwrap_or_default() > 0);
        assert!(
            !document["semantica"]["huella"]
                .as_str()
                .unwrap_or_default()
                .is_empty()
        );
        let total = document["censo"]["total"].as_u64().unwrap_or_default();
        assert_eq!(total, document["inferencia"]["nodos"].as_u64().unwrap_or(0));
    }

    #[test]
    fn una_transmutacion_admisible_actualiza_indice_memoria_y_generacion() {
        let _serial = serialized();
        let state = Mutex::new(CognitiveState::new());
        let before = parsed(&neural_frame(&state).unwrap_or_default());
        let result = parsed(&transmute_input(&state, DEMO_SOURCE).unwrap_or_default());
        assert_eq!(result["admisible"], true);
        assert!(result["sincronizacion"].is_object());
        assert!(!result["ast"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .is_empty());
        let after = parsed(&neural_frame(&state).unwrap_or_default());
        assert!(
            after["generacion"].as_u64().unwrap_or_default()
                > before["generacion"].as_u64().unwrap_or_default()
        );
        assert!(after["memoria"]["entradas"].as_u64().unwrap_or_default() > 0);
    }

    #[test]
    fn la_entrada_vacia_es_total_y_no_muta_el_estado() {
        let _serial = serialized();
        let state = Mutex::new(CognitiveState::new());
        let _ = neural_frame(&state);
        let before = parsed(&neural_frame(&state).unwrap_or_default());
        let result = parsed(&transmute_input(&state, "").unwrap_or_default());
        assert_eq!(result["admisible"], false);
        assert!(!result["motivo"].is_null());
        let after = parsed(&neural_frame(&state).unwrap_or_default());
        assert_eq!(before["generacion"], after["generacion"]);
    }

    #[test]
    fn la_caja_negra_se_lee_sin_escribir() {
        let _serial = serialized();
        let first = parsed(&flight_recorder_logs().unwrap_or_default());
        let second = parsed(&flight_recorder_logs().unwrap_or_default());
        assert!(first["contadores"]["capacidad"].as_u64().unwrap_or(0) > 0);
        assert!(first["entradas"].is_array());
        assert!(first["texto"]
            .as_str()
            .unwrap_or_default()
            .contains("caja negra"));
        assert_eq!(first["contadores"], second["contadores"]);
    }

    #[test]
    fn la_guarda_contiene_un_panico_sin_derribar_el_proceso() {
        let _serial = serialized();
        let outcome = guarded(|| -> Result<(), String> { panic!("fallo simulado") });
        assert!(outcome.is_err());
    }
}

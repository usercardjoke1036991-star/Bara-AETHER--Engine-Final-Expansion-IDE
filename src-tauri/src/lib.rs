//! # Bara IDE Desktop — backend Tauri v2 del IDE Bara (AETHER‑Ω)
//!
//! **Puente** entre la interfaz React (`web/`) y el motor de análisis
//! `bara-ide`, que a su vez envuelve el kernel congelado `bara` (etiqueta
//! `v0.1.0-kernel`). Aquí **no hay lógica lingüística**: sólo comandos
//! `#[tauri::command]` que proyectan el modelo de `bara-ide` a JSON.
//!
//! ## Comandos expuestos al front-end
//! * `analyze_source(source)` — analiza el texto del editor (siempre `Ok`:
//!   el lexer del kernel es total).
//! * `analyze_file(path)` — analiza un `.bara` del disco (`Err` legible).
//! * `kernel_catalogue()` — las seis raíces semánticas del kernel.
//! * `sample_genesis()` — documento *Shoresh* de ejemplo embebido.
//! * `read_document(path)` — texto de un `.bara` del disco, para el editor.
//! * `shoresh_translate(text)` — el léxico del kernel convierte lengua natural
//!   en raíces *Shoresh* (mismo traductor que el oráculo del REPL).
//! * `oracle_converse(input)` — conversa un turno con el **oráculo** del kernel
//!   y devuelve el turno, los `Δ⁻¹` aplicados y el estado de la sesión.
//! * `oracle_status()` — estado de la sesión: informe del oráculo, pila,
//!   diario `Δ⁻¹`, memoria holográfica, mutador autopoiético y malla.
//! * `oracle_turns()` — turnos conversados, en orden.
//! * `oracle_reset()` — cierra la sesión y devuelve su estado virgen.
//! * `temporal_deltas()` — diario temporal `Δ⁻¹` completo.
//! * `temporal_rollback(marker)` — **control temporal**: rebobina `Δ⁻¹` hasta
//!   un marcador (`next_marker` del estado).
//! * `belnap_lattice()` — tablas `∧`, `∨` y negación de la biláttice de
//!   **Belnap**, calculadas por el núcleo.
//! * `belnap_evaluate(truth, falsity)` — clasifica un par `(⊤, ⊥)` con el
//!   umbral de designación del kernel.

#![forbid(unsafe_code)]

use bara_ide::{
    Analysis, BelnapEvaluation, BelnapLattice, DeltaView, RootEntry, Session, SessionStatus,
    Translation, TurnResult, TurnView,
};
use std::sync::Mutex;

/// Analiza una fuente *Shoresh* con el kernel. Total: no puede fallar.
#[tauri::command]
fn analyze_source(source: String) -> Analysis {
    bara_ide::analyze(&source)
}

/// Analiza un documento `.bara` del disco.
#[tauri::command]
fn analyze_file(path: String) -> Result<Analysis, String> {
    bara_ide::read_source_file(&path).map(|source| bara_ide::analyze(&source))
}

/// Catálogo de raíces semánticas conocidas por el kernel.
#[tauri::command]
fn kernel_catalogue() -> Vec<RootEntry> {
    bara_ide::catalogue()
}

/// Documento *Shoresh* de ejemplo, embebido en el binario en tiempo de
/// compilación (no depende del directorio de trabajo).
#[tauri::command]
fn sample_genesis() -> String {
    bara_ide::SAMPLE_GENESIS.to_string()
}

/// Traduce lengua natural a *Shoresh* con el léxico del kernel: el panel de IA
/// muestra así el programa canónico que el propio núcleo compilaría, sin
/// duplicar el diccionario en TypeScript.
#[tauri::command]
fn shoresh_translate(text: String) -> Translation {
    bara_ide::translate(&text)
}

/// Devuelve el texto de un `.bara` del disco para cargarlo en el editor.
#[tauri::command]
fn read_document(path: String) -> Result<String, String> {
    bara_ide::read_source_file(&path)
}

/// Ejecuta una operación sobre la sesión sin `unwrap()`: si el cerrojo
/// quedara envenenado, la interfaz recibe un error legible en vez de un
/// aborto (A1 · totalidad).
fn with_session<T>(
    state: &tauri::State<'_, Mutex<Session>>,
    action: impl FnOnce(&mut Session) -> T,
) -> Result<T, String> {
    match state.lock() {
        Ok(mut session) => Ok(action(&mut session)),
        Err(_) => Err("sesión del oráculo no disponible (cerrojo envenenado)".to_string()),
    }
}

/// Conversa un turno con el oráculo del kernel.
#[tauri::command]
fn oracle_converse(
    input: String,
    state: tauri::State<'_, Mutex<Session>>,
) -> Result<TurnResult, String> {
    with_session(&state, |session| session.converse(&input))
}

/// Estado de la sesión: informe del oráculo, control temporal y runtime.
#[tauri::command]
fn oracle_status(state: tauri::State<'_, Mutex<Session>>) -> Result<SessionStatus, String> {
    with_session(&state, |session| session.status())
}

/// Turnos conversados en la sesión, en orden.
#[tauri::command]
fn oracle_turns(state: tauri::State<'_, Mutex<Session>>) -> Result<Vec<TurnView>, String> {
    with_session(&state, |session| session.turns())
}

/// Cierra la sesión y devuelve el estado virgen.
#[tauri::command]
fn oracle_reset(state: tauri::State<'_, Mutex<Session>>) -> Result<SessionStatus, String> {
    with_session(&state, |session| {
        session.reset();
        session.status()
    })
}

/// Diario temporal `Δ⁻¹` completo (incluye los deltas revertidos).
#[tauri::command]
fn temporal_deltas(state: tauri::State<'_, Mutex<Session>>) -> Result<Vec<DeltaView>, String> {
    with_session(&state, |session| session.deltas())
}

/// Control temporal: rebobina `Δ⁻¹` hasta `marker`.
#[tauri::command]
fn temporal_rollback(
    marker: u64,
    state: tauri::State<'_, Mutex<Session>>,
) -> Result<TurnResult, String> {
    with_session(&state, |session| session.rollback(marker))
}

/// Biláttice de Belnap completa, tal como la calcula el kernel.
///
/// Total por construcción: ninguna entrada puede hacerla fallar, así que no
/// devuelve `Result` ni entra en pánico.
#[tauri::command]
fn belnap_lattice() -> BelnapLattice {
    bara_ide::belnap_lattice()
}

/// Clasifica un par `(⊤, ⊥)` con la lógica de Belnap del kernel.
#[tauri::command]
fn belnap_evaluate(truth: f64, falsity: f64) -> BelnapEvaluation {
    bara_ide::belnap_evaluate(truth, falsity)
}

/// Arranca la ventana del IDE con los catorce comandos registrados.
///
/// La sesión del oráculo vive en el estado gestionado por Tauri: una sola
/// instancia por ventana, detrás del cerrojo que guarda [`with_session`].
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(Session::new()))
        .invoke_handler(tauri::generate_handler![
            analyze_source,
            analyze_file,
            kernel_catalogue,
            sample_genesis,
            read_document,
            shoresh_translate,
            oracle_converse,
            oracle_status,
            oracle_turns,
            oracle_reset,
            temporal_deltas,
            temporal_rollback,
            belnap_lattice,
            belnap_evaluate
        ])
        .run(tauri::generate_context!())
        .expect("Bara IDE: no se pudo iniciar la ventana (Tauri)");
}

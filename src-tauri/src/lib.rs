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
//!
//! ## Comandos del explorador de workspace
//! El backend es la única autoridad sobre el disco: no se duplica ninguna
//! validación de rutas en TypeScript.
//!
//! * `workspace_default_root()` — raíz inicial (workspace del repositorio).
//! * `workspace_tree(root)` — árbol recursivo sin `target/`, `node_modules/`
//!   ni `.git/`, con cotas de profundidad, entradas y tamaño.
//! * `workspace_read_document(root, path)` — lee un `.bara` confinado a la
//!   raíz canónica.
//! * `workspace_write_document(root, path, source)` — guarda un `.bara` dentro
//!   de la raíz canónica y devuelve el documento persistido.
//!
//! ## Comandos de la fase AETHER‑Ω (paneles del núcleo)
//! Todos **proyectan** el kernel sobre el texto vivo del editor y son totales
//! (salvo los de disco): el front-end no reimplementa ninguna semántica.
//!
//! * `autopoiesis(source)` — **Fase 1**: axiogénesis del AST (mutador
//!   autopoiético), valencia de Belnap por axioma y puerta ZK certificada.
//! * `quantum_native(source)` — **Fase 2**: banco de qubits, amplitudes con
//!   fase, entrelazamiento y fase de Bell del documento.
//! * `mesh_sync(source, peers, rounds, threaded)` — **Fase 2**: malla
//!   holográfica sincronizada por relojes vectoriales, con digest del estado.
//! * `metal_ir(source, device)` — **Fase 2**: baja el documento a Metal‑IR
//!   (ISA de 32 bits), asigna registros y resume el bypass del driver.
//! * `temporal_timeline(source)` — **Fase 2**: diario `Δ⁻¹` y pila de estados
//!   del documento (el rollback de la *sesión* sigue siendo
//!   `temporal_rollback(marker)`).
//! * `fractal_memory(source)` — **Fase 3**: reparto áureo/Fibonacci de los
//!   nodos de la memoria holográfica del documento.
//! * `fractal_plan(widths)` — **Fase 3**: reparto áureo de una lista de anchos
//!   arbitraria (lo que el panel use como *presupuesto* de retícula).
//!
//! ## Comandos del constructor visual (*Visual Builder*)
//! Proyectan el motor `bara::visual_builder` del kernel: el lienzo JSON
//! **estricto** se valida, se traduce a *Shoresh* y **se firma** (ADN) antes de
//! llegar al lienzo del editor. Ninguno guarda estado.
//!
//! * `visual_catalogue()` — clases de bloque, tipos y cotas del contrato.
//! * `visual_sample()` — lienzo de ejemplo del kernel (embebido en Rust).
//! * `visual_build(blueprint)` — traduce y firma un lienzo; `Err` legible si
//!   incumple el contrato.
//! * `visual_compose(blueprints)` — compone varios lienzos en un solo módulo
//!   firmado (el orden de la lista es significativo).
//!
//! ## Comandos del puente kernel → IDE (FASE 5)
//! Proyectan `bara::ide_bridge` a través de `bara_ide::bridge`. El kernel
//! escribe esos documentos con claves fijas en *snake_case* y sin `serde`; el
//! backend los reenvía **byte a byte** (`String`) para que el panel lea
//! exactamente el documento que el núcleo firma.
//!
//! * `bridge_manifest()` — contrato canónico: esquema, versión, secciones,
//!   cotas y huella (función pura, sin estado leído).
//! * `bridge_snapshot(source)` — instantánea de sólo lectura sobre el
//!   documento: identidad, inmunidad, pasarela y runtime. El texto entra por la
//!   pasarela de burbujas y el sistema adaptativo lo escanea; `Err` legible si
//!   el puente rechaza una sección (nunca una instantánea a medias).

#![forbid(unsafe_code)]

use bara_ide::{
    Analysis, AutopoiesisReport, BelnapEvaluation, BelnapLattice, DeltaView, FractalMemoryView,
    MeshView, MetalView, QuantumView, RootEntry, Session, SessionStatus, TimelineView, Translation,
    TurnResult, TurnView, VisualBuildView, VisualCatalogueView,
};
use std::sync::Mutex;

// Cockpit de telemetría: comandos de sólo lectura sobre `bara` + transmutador
// con estado cognitivo local a la ventana. Ver `src/telemetry.rs`.
mod telemetry;

// Explorador y almacén del workspace: enumeración recursiva y acceso a
// documentos `.bara` confinados a una raíz canónica. Ver `src/workspace.rs`.
mod workspace;

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

/// Raíz inicial del explorador (el workspace del repositorio, no `src-tauri/`).
#[tauri::command]
fn workspace_default_root() -> Result<String, String> {
    workspace::default_root()
}

/// Árbol recursivo del workspace, sin `target/`, `node_modules/` ni `.git/`.
#[tauri::command]
fn workspace_tree(root: String) -> Result<workspace::WorkspaceTree, String> {
    workspace::tree(&root)
}

/// Texto de un `.bara` confinado a la raíz canónica del workspace.
#[tauri::command]
fn workspace_read_document(
    root: String,
    path: String,
) -> Result<workspace::WorkspaceDocument, String> {
    workspace::read(&root, &path)
}

/// Guarda un `.bara` del workspace y devuelve el documento persistido.
#[tauri::command]
fn workspace_write_document(
    root: String,
    path: String,
    source: String,
) -> Result<workspace::WorkspaceDocument, String> {
    workspace::write(&root, &path, &source)
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

/// **Fase 1** — autopoiesis del AST, valencia de Belnap y puerta ZK.
///
/// Total: cualquier texto produce un informe (sin raíces desconocidas el
/// mutador queda en generación 0 y la puerta certifica los invariantes).
#[tauri::command]
fn autopoiesis(source: String) -> AutopoiesisReport {
    bara_ide::autopoiesis(&source)
}

/// **Fase 2** — banco cuántico nativo del documento.
#[tauri::command]
fn quantum_native(source: String) -> QuantumView {
    bara_ide::quantum_register(&source)
}

/// **Fase 2** — sincroniza la malla holográfica y proyecta sus nudos.
///
/// `peers` y `rounds` los acota el propio panel de `bara-ide`: la interfaz no
/// puede provocar una sincronización desmedida.
#[tauri::command]
fn mesh_sync(source: String, peers: usize, rounds: usize, threaded: bool) -> MeshView {
    bara_ide::mesh_status(&source, peers, rounds, threaded)
}

/// **Fase 2** — baja el documento a Metal‑IR para el dispositivo pedido.
///
/// `device` es opcional (`"cpu"` por defecto): cualquier otro valor que no
/// nombre la GPU se resuelve como CPU, sin fallar.
#[tauri::command]
fn metal_ir(source: String, device: Option<String>) -> MetalView {
    bara_ide::metal_program(&source, device.as_deref().unwrap_or("cpu"))
}

/// **Fase 2** — diario `Δ⁻¹` del documento y cumbre de su pila de estados.
#[tauri::command]
fn temporal_timeline(source: String) -> TimelineView {
    bara_ide::timeline(&source)
}

/// **Fase 3** — reparto áureo/Fibonacci de la memoria del documento.
#[tauri::command]
fn fractal_memory(source: String) -> FractalMemoryView {
    bara_ide::fractal_memory(&source)
}

/// **Fase 3** — reparto áureo de una lista de anchos arbitraria.
///
/// Total: una lista vacía o desmedida se acota dentro del panel (el reparto
/// siempre respeta su cota superior de Fibonacci).
#[tauri::command]
fn fractal_plan(widths: Vec<usize>) -> FractalMemoryView {
    bara_ide::fractal_plan(&widths)
}

/// Contrato del *Visual Builder*: clases, tipos y cotas del lienzo.
///
/// Total: el vocabulario lo sirve el kernel, de modo que el panel no repite ni
/// un literal del contrato.
#[tauri::command]
fn visual_catalogue() -> VisualCatalogueView {
    bara_ide::visual_catalogue()
}

/// Lienzo de ejemplo del kernel, para el editor del panel.
#[tauri::command]
fn visual_sample() -> String {
    bara_ide::visual_sample()
}

/// Traduce, valida y **firma** un lienzo JSON estricto.
///
/// `Err` legible (nunca un aborto) cuando el lienzo incumple el contrato: una
/// clave desconocida, un tipo fuera del catálogo o una referencia hacia delante
/// invalidan el lienzo entero en vez de compilarse a medias.
#[tauri::command]
fn visual_build(blueprint: String) -> Result<VisualBuildView, String> {
    bara_ide::visual_build(&blueprint)
}

/// Compone varios lienzos en un único ADN firmado.
///
/// El orden de `blueprints` es significativo: fija la etiqueta firmada (la del
/// primero, con sufijo `:compuesto`) y la raíz de Merkle del conjunto.
#[tauri::command]
fn visual_compose(blueprints: Vec<String>) -> Result<VisualBuildView, String> {
    bara_ide::visual_compose(&blueprints)
}

/// **Fase 5** — contrato canónico del puente kernel → IDE.
///
/// Devuelve el JSON de `bara::ide_bridge::Manifest::canon` sin recomillar: el
/// panel lo guarda al conectar y compara después la huella de cada instantánea
/// para detectar cualquier deriva de esquema sin leer estado del núcleo.
#[tauri::command]
fn bridge_manifest() -> String {
    bara_ide::bridge_manifest()
}

/// **Fase 5** — instantánea de sólo lectura del kernel sobre el documento.
///
/// El texto del editor entra por la pasarela de burbujas y el sistema
/// inmunitario adaptativo lo escanea; el JSON devuelto es exactamente el que
/// publica `bara::ide_bridge::Snapshot::capture` (claves fijas en *snake_case*).
/// `Err` legible si el puente rechaza una sección: el panel nunca pinta una
/// instantánea a medias.
#[tauri::command]
fn bridge_snapshot(source: String) -> Result<String, String> {
    bara_ide::bridge_snapshot(&source)
}

// ─────────────────────────────────────────────────────────────────────────
// Cockpit de telemetría (FASE 6) — `src/telemetry.rs`
// ─────────────────────────────────────────────────────────────────────────
// Todos los comandos devuelven `Result<String, String>` y pasan por
// `telemetry::guarded`: un pánico inesperado del backend se convierte en un
// error IPC, nunca en la caída de la ventana.

/// Manifiesto ontológico canónico + huella de identidad del puente.
#[tauri::command]
fn get_system_manifest() -> Result<String, String> {
    telemetry::guarded(telemetry::system_manifest)
}

/// Marco cognitivo completo (`NeuralFrame::json`): inferencia, censo de Belnap,
/// memoria a largo plazo y vista semántica *Shoresh* (`NeuralIT`).
#[tauri::command]
fn get_neural_frame(
    state: tauri::State<'_, Mutex<telemetry::CognitiveState>>,
) -> Result<String, String> {
    telemetry::guarded(|| telemetry::neural_frame(&state))
}

/// Volcado de sólo lectura de la caja negra (Flight Recorder).
#[tauri::command]
fn get_flight_recorder_logs() -> Result<String, String> {
    telemetry::guarded(telemetry::flight_recorder_logs)
}

/// Transmuta código/texto externo, lo audita y lo indexa si es admisible.
#[tauri::command(rename_all = "snake_case")]
fn transmute_input(
    source_code: String,
    state: tauri::State<'_, Mutex<telemetry::CognitiveState>>,
) -> Result<String, String> {
    telemetry::guarded(|| telemetry::transmute_input(&state, &source_code))
}

/// Arranca la ventana del IDE con los treinta y cinco comandos registrados.
///
/// La sesión del oráculo vive en el estado gestionado por Tauri: una sola
/// instancia por ventana, detrás del cerrojo que guarda [`with_session`].
/// Los comandos de la fase AETHER‑Ω, los del constructor visual y los del
/// puente son funciones puras sobre el texto del editor: no tocan la sesión ni
/// comparten estado.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(Session::new()))
        .manage(Mutex::new(telemetry::CognitiveState::new()))
        .invoke_handler(tauri::generate_handler![
            analyze_source,
            analyze_file,
            kernel_catalogue,
            sample_genesis,
            read_document,
            workspace_default_root,
            workspace_tree,
            workspace_read_document,
            workspace_write_document,
            shoresh_translate,
            oracle_converse,
            oracle_status,
            oracle_turns,
            oracle_reset,
            temporal_deltas,
            temporal_rollback,
            belnap_lattice,
            belnap_evaluate,
            autopoiesis,
            quantum_native,
            mesh_sync,
            metal_ir,
            temporal_timeline,
            fractal_memory,
            fractal_plan,
            visual_catalogue,
            visual_sample,
            visual_build,
            visual_compose,
            bridge_manifest,
            bridge_snapshot,
            get_system_manifest,
            get_neural_frame,
            get_flight_recorder_logs,
            transmute_input
        ])
        .run(tauri::generate_context!())
        .expect("Bara IDE: no se pudo iniciar la ventana (Tauri)");
}

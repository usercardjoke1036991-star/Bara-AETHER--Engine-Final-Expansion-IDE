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
//! * `analyze_file(path)` — analiza un `.bara` confinado a la raíz activa.
//! * `kernel_catalogue()` — las seis raíces semánticas del kernel.
//! * `sample_genesis()` — documento *Shoresh* de ejemplo embebido.
//! * `read_document(path)` — texto de un `.bara` confinado a la raíz activa.
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
//!   No cambia la jaula: el WebView no puede instalarla.
//! * `workspace_tree()` — árbol de la raíz activa. No acepta ruta.
//! * `workspace_read_document(path)` — lee un `.bara` relativo de esa raíz.
//! * `workspace_write_document(path, source)` — guarda un `.bara` relativo.
//! * `get_local_completions(line, prefix, path)` — sugerencias locales del
//!   cursor. `path` es el documento relativo; no elige la carpeta.
//! * `get_workspace_topology_graph()` — nodos y aristas de la carpeta activa.
//! * `workspace_source_text(path)` — lee una fuente del proyecto (sólo
//!   relativa) para saltar desde el grafo. No escribe.
//! * `run_workspace_recipe(recipe)` — `check`, `test` o `typecheck`. El
//!   proceso y los argumentos son literales; no hay shell. Cada receta
//!   se corta a los 30 s.
//! * `judge_auto_patch(path, line, host, patch)` — el núcleo juzga el bloque.
//!   Sólo un `∅` se escribe, en la ruta relativa de la raíz activa.
//! * `load_local_weights()` — diálogo del sistema para un `.gguf`. No recibe ruta.
//! * `local_complete(prompt)` — responde con el núcleo y los pesos ya cargados.
//! * `transmute_global(path, from, to)` — propaga un identificador por la red.
//!   Escribe sólo si ningún archivo queda en `⊤∧⊥`.
//! * `idle_proposal()` — aviso del hilo de reposo, si hay una redundancia `∅`.
//! * `idle_apply()` / `idle_dismiss()` — confirman o descartan ese aviso.
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
    TurnResult, TurnView, VisualBuildView, VisualCatalogueView, VisualEmission,
};
use std::sync::Mutex;
use tauri::Manager;

// Cockpit de telemetría: comandos de sólo lectura sobre `bara` + transmutador
// con estado cognitivo local a la ventana. Ver `src/telemetry.rs`.
mod telemetry;

// Explorador y almacén del workspace: enumeración recursiva y acceso a
// documentos `.bara` confinados a una raíz canónica. Ver `src/workspace.rs`.
mod workspace;

// Clonado de GitHub: URL allowlist y `git clone` sin shell. Ver `src/import.rs`.
mod import;

// Cota de 32 MiB para archivos multimedia elegidos en el diálogo nativo.
mod media;

// Autocompletado local: catálogo Shoresh, carta de la carpeta y malla. Sin red.
mod completion;

// Grafo topológico de la carpeta activa. Sin red y sin raíz impuesta.
mod graph;

// Recetas de un clic. El proceso vive aquí, fuera del slice del handler.
mod orchestrate;

// Veto de Belnap del modo autónomo. Escribe sólo con veredicto ∅.
mod auto_apply;

// GGUF local y respuesta hermética. Sin red y sin FFI.
mod local_infer;

// Renombre trans-archivo. Escribe sólo si la red no contiene ⊤∧⊥.
mod global_transmute;

// Hilo de reposo. Propone una redundancia; no escribe hasta el cockpit.
mod idle_worker;

/// Analiza una fuente *Shoresh* con el kernel. Total: no puede fallar.
#[tauri::command]
fn analyze_source(source: String) -> Analysis {
    bara_ide::analyze(&source)
}

/// Analiza un `.bara` de la raíz activa. Fuera de esa jaula no hay lectura.
#[tauri::command]
fn analyze_file(
    path: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<Analysis, String> {
    workspace::read(&state.get()?, &path).map(|document| bara_ide::analyze(&document.source))
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

/// Texto de un `.bara` confinado a la raíz activa del workspace.
#[tauri::command]
fn read_document(
    path: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<String, String> {
    workspace::read(&state.get()?, &path).map(|document| document.source)
}

/// Raíz inicial del explorador (el workspace del repositorio, no `src-tauri/`).
#[tauri::command]
fn workspace_default_root() -> Result<String, String> {
    workspace::default_root()
}

/// Sugerencias de autocompletado. La carpeta es la activa; `path` no la cambia.
#[tauri::command]
fn get_local_completions(
    line: u32,
    prefix: String,
    path: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    cache: tauri::State<'_, Mutex<completion::CompletionCache>>,
) -> Result<Vec<completion::LocalCompletion>, String> {
    completion::answer(line, &prefix, &path, &state, &cognition, &cache)
}

/// Grafo de la carpeta activa: nodos, aristas y distancia topológica.
#[tauri::command]
fn get_workspace_topology_graph(
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<graph::WorkspaceTopology, String> {
    graph::build(&state.get()?)
}

/// Compila, prueba o revisa tipos. El nombre es un catálogo cerrado.
#[tauri::command]
async fn run_workspace_recipe(
    recipe: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<orchestrate::RecipeReport, String> {
    let name = recipe.trim().to_string();
    if name.len() > 16 {
        return Err("la receta no está en el catálogo cerrado".to_string());
    }
    let root = state.get().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let active = root.as_deref().map(std::path::Path::new);
        orchestrate::run(&name, active)
    })
    .await
    .map_err(|_| "la receta se interrumpió".to_string())?
}

/// Juzga un bloque del asistente. La carpeta es la activa; `path` no la cambia.
#[tauri::command]
fn judge_auto_patch(
    path: String,
    line: u32,
    host: String,
    patch: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<auto_apply::AutoApplyReport, String> {
    auto_apply::judge(&state.get()?, &path, line, &host, &patch)
}

/// Elige un `.gguf` en el diálogo del sistema y guarda sólo su cabecera.
#[tauri::command]
async fn load_local_weights(
    app: tauri::AppHandle,
    slot: tauri::State<'_, Mutex<local_infer::LocalSlot>>,
) -> Result<local_infer::WeightView, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .set_title("Cargar pesos GGUF")
        .add_filter("GGUF", &["gguf"])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Err("cancelado".to_string());
    };
    let path = match file {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        tauri_plugin_dialog::FilePath::Url(_) => {
            return Err("la selección no es un archivo local".to_string());
        }
    };
    let model = local_infer::load_file(&path)?;
    let view = local_infer::WeightView::from(&model);
    match slot.lock() {
        Ok(mut guard) => guard.install(model),
        Err(_) => return Err("el modelo local no está disponible".to_string()),
    }
    Ok(view)
}

/// Resuelve un prompt con los pesos locales. No abre la red.
#[tauri::command]
fn local_complete(
    prompt: String,
    slot: tauri::State<'_, Mutex<local_infer::LocalSlot>>,
) -> Result<local_infer::LocalReply, String> {
    let model = match slot.lock() {
        Ok(guard) => guard
            .card()
            .cloned()
            .ok_or_else(|| "no hay pesos locales cargados".to_string())?,
        Err(_) => return Err("el modelo local no está disponible".to_string()),
    };
    Ok(local_infer::complete(&model, &prompt))
}

/// Propaga un identificador por el grafo de la carpeta activa.
#[tauri::command]
fn transmute_global(
    path: String,
    from: String,
    to: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<global_transmute::GlobalReport, String> {
    global_transmute::propagate(&state.get()?, &path, &from, &to)
}

/// Aviso del hilo de reposo. Vacío si no hay una optimización limpia.
#[tauri::command]
fn idle_proposal(
    slot: tauri::State<'_, Mutex<idle_worker::IdleSlot>>,
) -> Result<Option<idle_worker::IdleNotice>, String> {
    match slot.lock() {
        Ok(guard) => Ok(guard.current()),
        Err(_) => Err("el reposo no está disponible".to_string()),
    }
}

/// Escribe la optimización si el archivo sigue en `∅`.
#[tauri::command]
fn idle_apply(
    slot: tauri::State<'_, Mutex<idle_worker::IdleSlot>>,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<bool, String> {
    let notice = match slot.lock() {
        Ok(guard) => guard.current(),
        Err(_) => return Err("el reposo no está disponible".to_string()),
    };
    let Some(notice) = notice else {
        return Ok(false);
    };
    let wrote = idle_worker::apply(&state.get()?, &notice)?;
    if let Ok(mut guard) = slot.lock() {
        guard.clear();
    }
    Ok(wrote)
}

/// Descarta el aviso sin tocar el disco.
#[tauri::command]
fn idle_dismiss(slot: tauri::State<'_, Mutex<idle_worker::IdleSlot>>) -> Result<(), String> {
    match slot.lock() {
        Ok(mut guard) => {
            guard.clear();
            Ok(())
        }
        Err(_) => Err("el reposo no está disponible".to_string()),
    }
}

/// Lee una fuente relativa del proyecto para abrirla en el editor.
#[tauri::command]
fn workspace_source_text(
    path: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceDocument, String> {
    workspace::read_text(&state.get()?, &path)
}

/// Árbol de la raíz activa. Una ruta enviada por el WebView no existe en la firma.
#[tauri::command]
fn workspace_tree(
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceTree, String> {
    workspace::tree(&state.get()?)
}

/// Texto de un `.bara` relativo a la raíz activa. Rechaza absolutos y `..`.
#[tauri::command]
fn workspace_read_document(
    path: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceDocument, String> {
    workspace::read(&state.get()?, &path)
}

/// Guarda un `.bara` relativo a la raíz activa y devuelve el documento persistido.
#[tauri::command]
fn workspace_write_document(
    path: String,
    source: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceDocument, String> {
    workspace::write(&state.get()?, &path, &source)
}

/// Suelta la malla y el oráculo de una carpeta. La usan el cierre y la expulsión LRU.
fn release_folder(
    cognition: &Mutex<telemetry::CognitiveShelf>,
    sessions: &Mutex<telemetry::OracleShelf>,
    path: &str,
) {
    if let Ok(mut mesh) = cognition.lock() {
        mesh.forget(path);
    }
    if let Ok(mut oracle) = sessions.lock() {
        oracle.forget(path);
    }
}

/// Instala una raíz ya validada por el diálogo o por el clon y purga la expulsada.
fn adopt_root(
    state: &workspace::ActiveWorkspace,
    cognition: &Mutex<telemetry::CognitiveShelf>,
    sessions: &Mutex<telemetry::OracleShelf>,
    root: String,
) {
    if let Some(evicted) = state.set(root) {
        release_folder(cognition, sessions, &evicted);
    }
}

/// Ejecuta una operación sobre la sesión de la carpeta activa.
fn with_oracle<T>(
    shelf: &tauri::State<'_, Mutex<telemetry::OracleShelf>>,
    scope: &str,
    action: impl FnOnce(&mut Session) -> T,
) -> Result<T, String> {
    match shelf.lock() {
        Ok(mut guard) => Ok(action(guard.session(scope))),
        Err(_) => Err("sesión del oráculo no disponible (cerrojo envenenado)".to_string()),
    }
}

fn stamp(status: &mut SessionStatus, folder_id: &str) {
    status.workspace_id = folder_id.to_string();
}

/// Conversa un turno con el oráculo de la carpeta activa.
#[tauri::command]
fn oracle_converse(
    input: String,
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<TurnResult, String> {
    let (scope, folder_id) = folder_of(&workspace)?;
    let from = bara::flight_recorder::mark();
    let mut turn = with_oracle(&sessions, &scope, |session| session.converse(&input))?;
    let to = bara::flight_recorder::mark();
    if let Ok(mut shelf) = cognition.lock() {
        shelf.note_span(&scope, from, to);
    }
    stamp(&mut turn.status, &folder_id);
    Ok(turn)
}

/// Estado de la sesión de la carpeta activa.
#[tauri::command]
fn oracle_status(
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<SessionStatus, String> {
    let (scope, folder_id) = folder_of(&workspace)?;
    let mut status = with_oracle(&sessions, &scope, |session| session.status())?;
    stamp(&mut status, &folder_id);
    Ok(status)
}

/// Turnos conversados en la sesión de la carpeta activa, en orden.
#[tauri::command]
fn oracle_turns(
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<Vec<TurnView>, String> {
    let (scope, _) = folder_of(&workspace)?;
    with_oracle(&sessions, &scope, |session| session.turns())
}

/// Cierra la sesión de la carpeta activa y devuelve el estado virgen.
#[tauri::command]
fn oracle_reset(
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<SessionStatus, String> {
    let (scope, folder_id) = folder_of(&workspace)?;
    let mut status = with_oracle(&sessions, &scope, |session| {
        session.reset();
        session.status()
    })?;
    stamp(&mut status, &folder_id);
    Ok(status)
}

/// Diario temporal `Δ⁻¹` de la carpeta activa.
#[tauri::command]
fn temporal_deltas(
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<Vec<DeltaView>, String> {
    let (scope, _) = folder_of(&workspace)?;
    with_oracle(&sessions, &scope, |session| session.deltas())
}

/// Control temporal: rebobina `Δ⁻¹` hasta `marker` en la carpeta activa.
#[tauri::command]
fn temporal_rollback(
    marker: u64,
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<TurnResult, String> {
    let (scope, folder_id) = folder_of(&workspace)?;
    let from = bara::flight_recorder::mark();
    let mut turn = with_oracle(&sessions, &scope, |session| session.rollback(marker))?;
    let to = bara::flight_recorder::mark();
    if let Ok(mut shelf) = cognition.lock() {
        shelf.note_span(&scope, from, to);
    }
    stamp(&mut turn.status, &folder_id);
    Ok(turn)
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

/// Reconstruye el lienzo en el kernel y sólo entonces entrega el `.bara`.
///
/// La interfaz no puede llevar al editor el texto que tenía en memoria: este
/// comando vuelve a traducir, exige `verified` y un sello de 32 bytes, y
/// rechaza el documento si algo de eso falla.
#[tauri::command]
fn visual_emit(blueprint: String) -> Result<VisualEmission, String> {
    bara_ide::visual_emit(&blueprint)
}

/// Emisión de una composición: mismo sello, el orden de los lienzos importa.
#[tauri::command]
fn visual_emit_composed(blueprints: Vec<String>) -> Result<VisualEmission, String> {
    bara_ide::visual_emit_composed(&blueprints)
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
// `telemetry::guarded`: en debug, un pánico inesperado del backend se convierte
// en un error IPC. El perfil release aborta, así que ahí la guarda no alcanza.

/// Manifiesto ontológico canónico + huella de identidad del puente.
#[tauri::command]
fn get_system_manifest() -> Result<String, String> {
    telemetry::guarded(telemetry::system_manifest)
}

/// Marco cognitivo completo (`NeuralFrame::json`): inferencia, censo de Belnap,
/// memoria a largo plazo y vista semántica *Shoresh* (`NeuralIT`).
#[tauri::command]
fn get_neural_frame(
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<String, String> {
    let scope = cognitive_scope(&workspace)?;
    telemetry::guarded(|| telemetry::neural_frame(&cognition, &scope))
}

/// Volcado de la caja negra limitado a los tramos de la carpeta activa.
#[tauri::command]
fn get_flight_recorder_logs(
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<String, String> {
    let (scope, folder_id) = folder_of(&workspace)?;
    telemetry::guarded(|| telemetry::flight_recorder_logs(&cognition, &scope, &folder_id))
}

/// Transmuta código/texto externo, lo audita y lo indexa si es admisible.
#[tauri::command(rename_all = "snake_case")]
fn transmute_input(
    source_code: String,
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<String, String> {
    let scope = cognitive_scope(&workspace)?;
    telemetry::guarded(|| telemetry::transmute_input(&cognition, &scope, &source_code))
}

/// Ventanas de escritorio que el IDE sabe abrir. El identificador es la
/// etiqueta Tauri y, en React, el nombre de la vista.
const DESK_VISTAS: &[(&str, &str, f64, f64)] = &[
    ("main", "Bara IDE — AETHER-Ω", 1180.0, 760.0),
    ("topology", "Bara — Topología", 920.0, 680.0),
    ("autopoiesis", "Bara — Autopoiesis", 920.0, 680.0),
    ("telemetry", "Bara — Cockpit", 920.0, 680.0),
    ("ai-workspace", "Bara — Asistencia", 1080.0, 740.0),
];

fn desk_spec(vista: &str) -> Option<(&'static str, f64, f64)> {
    DESK_VISTAS
        .iter()
        .find(|(id, ..)| *id == vista)
        .map(|(_, title, width, height)| (*title, *width, *height))
}

fn cognitive_scope(workspace: &workspace::ActiveWorkspace) -> Result<String, String> {
    workspace.get()
}

fn folder_of(workspace: &workspace::ActiveWorkspace) -> Result<(String, String), String> {
    let scope = cognitive_scope(workspace)?;
    let folder_id = workspace::root_id(&scope);
    Ok((scope, folder_id))
}

/// Abre o enfoca una ventana registrada. La etiqueta no la inventa el WebView:
/// tiene que estar en [`DESK_VISTAS`].
///
/// El comando es `async` a propósito. En Windows, `WebviewWindowBuilder` dentro
/// de un comando síncrono bloquea el hilo de WebView2: la ventana nace y se
/// queda en `about:blank` (pantalla blanca que ni siquiera cierra).
#[tauri::command]
async fn open_desk_window(app: tauri::AppHandle, vista: String) -> Result<(), String> {
    let vista = vista.trim().to_string();
    let (title, width, height) =
        desk_spec(&vista).ok_or_else(|| "ventana no registrada".to_string())?;
    if let Some(window) = app.get_webview_window(&vista) {
        let blank = window
            .url()
            .map(|current| current.as_str() == "about:blank")
            .unwrap_or(true);
        if !blank {
            window.set_focus().map_err(|err| err.to_string())?;
            return Ok(());
        }
        let _ = window.close();
    }
    tauri::WebviewWindowBuilder::new(&app, vista, tauri::WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(640.0, 420.0)
        .background_color(tauri::window::Color(11, 15, 20, 255))
        .center()
        .build()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

/// Estante de carpetas abiertas. Cada una es una jaula distinta.
#[tauri::command]
fn workspace_roots(
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceShelf, String> {
    state.list()
}

/// Activa una carpeta por el identificador que emitió el backend.
#[tauri::command]
fn workspace_activate(
    id: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceShelf, String> {
    state.activate(id.trim())
}

/// Cierra una carpeta del estante. La última permanece.
#[tauri::command]
fn workspace_close_root(
    id: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
) -> Result<workspace::WorkspaceShelf, String> {
    let (path, shelf) = state.release(id.trim())?;
    release_folder(&cognition, &sessions, &path);
    Ok(shelf)
}

/// Transmuta el árbol de la carpeta activa. La ruta no la elige el WebView.
#[tauri::command]
fn transmute_workspace(
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<String, String> {
    let root = workspace.get()?;
    let project = bara::transmute_engine::transmute_workspace_dir(std::path::Path::new(&root))?;
    let distance = if project.topology.nearest == u16::MAX {
        serde_json::Value::Null
    } else {
        serde_json::json!(project.topology.nearest)
    };
    Ok(serde_json::json!({
        "archivos": project.files,
        "archivos_omitidos": project.omitted_files,
        "trozos": project.chunks,
        "sentencias": project.statements,
        "nodos": project.nodes.len(),
        "nodos_omitidos": project.omitted_nodes,
        "cohesion_mili": project.topology.cohesion_milli,
        "solapes": project.topology.overlaps,
        "distancia": distance,
        "alerta": project.topology.alert,
        "foco": project.topology.focus.as_str(),
        "vecino": project.topology.neighbor.as_str(),
        "lenguajes": project.languages,
    })
    .to_string())
}

/// Elige un archivo multimedia en el diálogo del sistema y aplica la cota de 32 MiB.
///
/// No devuelve píxeles ni la ruta absoluta. Cancelar responde `cancelado`.
#[tauri::command]
async fn inspect_media_dialog(app: tauri::AppHandle) -> Result<media::MediaInspection, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .set_title("Adjuntar imagen o video")
        .add_filter(
            "Multimedia",
            &["mp4", "webm", "png", "jpg", "jpeg", "gif", "webp"],
        )
        .blocking_pick_file();
    let Some(file) = picked else {
        return Err("cancelado".to_string());
    };
    let path = match file {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        tauri_plugin_dialog::FilePath::Url(_) => {
            return Err("la selección no es un archivo local".to_string());
        }
    };
    media::inspect_media_file(&path)
}

/// Abre el diálogo nativo de carpetas, canoniza la elección y la vuelve la raíz activa.
///
/// La ruta no viaja desde el WebView: sale del diálogo del sistema operativo.
/// Cancelar devuelve el error estable `cancelado`, sin tocar el workspace.
#[tauri::command]
async fn workspace_open_dialog(
    app: tauri::AppHandle,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
) -> Result<workspace::WorkspaceTree, String> {
    let folder = pick_folder(&app, "Abrir carpeta del workspace")?;
    let tree = workspace::tree(&folder.display().to_string())?;
    adopt_root(&state, &cognition, &sessions, tree.root.clone());
    Ok(tree)
}

/// Clona un repositorio de GitHub dentro de la carpeta que elija el diálogo.
///
/// Primero se valida la URL. Después el usuario elige el directorio padre.
/// `git` corre con argumentos fijos, sin shell. Al terminar, ese clon es el
/// workspace activo y el árbol ya viene sin `target/`, `node_modules/` ni `.git/`.
#[tauri::command]
async fn github_clone(
    app: tauri::AppHandle,
    url: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    cognition: tauri::State<'_, Mutex<telemetry::CognitiveShelf>>,
    sessions: tauri::State<'_, Mutex<telemetry::OracleShelf>>,
) -> Result<workspace::WorkspaceTree, String> {
    // Validar antes de abrir el diálogo: una URL mala no pide carpeta.
    let _ = import::github_remote(&url)?;
    let parent = pick_folder(&app, "Carpeta donde clonar el repositorio")?;
    let app_clone = app.clone();
    let cloned = tauri::async_runtime::spawn_blocking(move || {
        import::clone_repository(&app_clone, &parent, &url)
    })
    .await
    .map_err(|_| "el clon se interrumpió".to_string())??;
    let tree = workspace::tree(&cloned.display().to_string())?;
    adopt_root(&state, &cognition, &sessions, tree.root.clone());
    Ok(tree)
}

/// Diálogo de carpeta. `cancelado` es el contrato que la interfaz no pinta en rojo.
fn pick_folder(app: &tauri::AppHandle, title: &str) -> Result<std::path::PathBuf, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app.dialog().file().set_title(title).blocking_pick_folder();
    let Some(file) = picked else {
        return Err("cancelado".to_string());
    };
    let path = match file {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        tauri_plugin_dialog::FilePath::Url(_) => {
            return Err("la selección no es una carpeta local".to_string());
        }
    };
    workspace::resolve_root(&path.display().to_string())
}

/// Arranca la ventana del IDE con los cincuenta y seis comandos registrados.
///
/// La sesión del oráculo vive en el estado gestionado por Tauri: una sola
/// instancia por ventana, detrás del cerrojo que guarda [`with_session`].
/// Los comandos de la fase AETHER‑Ω, los del constructor visual y los del
/// puente son funciones puras sobre el texto del editor: no tocan la sesión ni
/// comparten estado.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(telemetry::OracleShelf::new()))
        .manage(Mutex::new(telemetry::CognitiveShelf::new()))
        .manage(workspace::ActiveWorkspace::bootstrap())
        .manage(Mutex::new(completion::CompletionCache::new()))
        .manage(Mutex::new(local_infer::LocalSlot::new()))
        .manage(Mutex::new(idle_worker::IdleSlot::new()))
        .setup(|app| {
            idle_worker::start(app.handle().clone());
            Ok(())
        })
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
            workspace_open_dialog,
            workspace_roots,
            workspace_activate,
            workspace_close_root,
            open_desk_window,
            transmute_workspace,
            inspect_media_dialog,
            github_clone,
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
            visual_emit,
            visual_emit_composed,
            bridge_manifest,
            bridge_snapshot,
            get_system_manifest,
            get_neural_frame,
            get_flight_recorder_logs,
            transmute_input,
            get_local_completions,
            get_workspace_topology_graph,
            workspace_source_text,
            run_workspace_recipe,
            judge_auto_patch,
            load_local_weights,
            local_complete,
            transmute_global,
            idle_proposal,
            idle_apply,
            idle_dismiss
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Bara IDE: no se pudo iniciar la ventana (Tauri): {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod ipc_boundary {
    use std::sync::Mutex;

    #[test]
    fn la_cli_y_la_pty_no_entran_en_el_handler() {
        let src = include_str!("lib.rs");
        let handler = src
            .split_once("generate_handler!")
            .expect("handler")
            .1
            .split_once("])")
            .expect("cierre del handler")
            .0;
        assert!(handler.contains("oracle_converse"));
        assert!(handler.contains("open_desk_window"));
        assert!(handler.contains("workspace_activate"));
        assert!(handler.contains("transmute_workspace"));
        assert!(handler.contains("inspect_media_dialog"));
        assert!(handler.contains("get_local_completions"));
        assert!(handler.contains("get_workspace_topology_graph"));
        assert!(handler.contains("workspace_source_text"));
        assert!(handler.contains("run_workspace_recipe"));
        assert!(handler.contains("judge_auto_patch"));
        assert!(handler.contains("load_local_weights"));
        assert!(handler.contains("local_complete"));
        assert!(handler.contains("transmute_global"));
        assert!(handler.contains("idle_proposal"));
        assert!(handler.contains("idle_apply"));
        assert!(handler.contains("idle_dismiss"));
        assert!(!handler.contains("read_source"));
        assert!(super::desk_spec("topology").is_some());
        assert!(super::desk_spec("ai-workspace").is_some());
        assert!(super::desk_spec("pty").is_none());
        assert!(super::desk_spec("../main").is_none());
        assert!(!handler.to_ascii_lowercase().contains("pty"));
        assert!(!handler.contains("Command::new"));
        assert!(!handler.contains("cmd /c") && !handler.contains("sh -c"));
    }

    #[test]
    fn el_webview_no_puede_imponer_una_raiz() {
        let src = include_str!("lib.rs");
        for name in [
            "fn workspace_tree(",
            "fn workspace_read_document(",
            "fn workspace_write_document(",
            "fn get_local_completions(",
            "fn get_workspace_topology_graph(",
            "fn workspace_source_text(",
            "fn run_workspace_recipe(",
            "fn judge_auto_patch(",
            "fn load_local_weights(",
            "fn local_complete(",
            "fn transmute_global(",
            "fn idle_proposal(",
            "fn idle_apply(",
            "fn idle_dismiss(",
        ] {
            let signature = src
                .split(name)
                .nth(1)
                .and_then(|rest| rest.split('{').next())
                .unwrap_or("");
            assert!(
                !signature.contains("root:"),
                "{name} no puede aceptar una raíz del WebView"
            );
        }
    }

    #[test]
    fn la_novena_carpeta_olvida_la_malla_y_el_oraculo() {
        let workspace = super::workspace::ActiveWorkspace::empty();
        let cognition = Mutex::new(super::telemetry::CognitiveShelf::new());
        let sessions = Mutex::new(super::telemetry::OracleShelf::new());
        let mut paths = Vec::new();
        for index in 0..super::workspace::ROOT_CAP {
            let dir =
                std::env::temp_dir().join(format!("bara-olvido-{index}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("directorio");
            let path = super::workspace::resolve_root(dir.to_str().expect("utf-8"))
                .expect("canon")
                .display()
                .to_string();
            super::adopt_root(&workspace, &cognition, &sessions, path.clone());
            paths.push((dir, path));
        }
        {
            let mut mesh = cognition.lock().expect("malla");
            mesh.note_span(&paths[0].1, 1, 2);
            mesh.note_span(&paths[1].1, 3, 4);
        }
        {
            let mut oracle = sessions.lock().expect("oráculo");
            let _ = oracle.session(&paths[1].1).converse("hola");
            assert!(!oracle.session(&paths[1].1).turns().is_empty());
        }
        super::adopt_root(&workspace, &cognition, &sessions, paths[0].1.clone());
        let extra_dir =
            std::env::temp_dir().join(format!("bara-olvido-extra-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&extra_dir);
        std::fs::create_dir_all(&extra_dir).expect("extra");
        let extra = super::workspace::resolve_root(extra_dir.to_str().expect("utf-8"))
            .expect("canon")
            .display()
            .to_string();
        super::adopt_root(&workspace, &cognition, &sessions, extra);
        assert!(
            cognition
                .lock()
                .expect("malla")
                .spans_of(&paths[1].1)
                .is_empty(),
            "la carpeta expulsada debe perder la malla"
        );
        assert!(!cognition
            .lock()
            .expect("malla")
            .spans_of(&paths[0].1)
            .is_empty());
        assert!(sessions
            .lock()
            .expect("oráculo")
            .session(&paths[1].1)
            .turns()
            .is_empty());
        for (dir, _) in paths {
            let _ = std::fs::remove_dir_all(dir);
        }
        let _ = std::fs::remove_dir_all(extra_dir);
    }

    #[test]
    fn la_csp_solo_admite_el_origen_local_y_los_dos_proveedores() {
        let conf = include_str!("../tauri.conf.json");
        assert!(!conf.contains("\"csp\": null"));
        assert!(conf.contains("https://api.anthropic.com"));
        assert!(conf.contains("https://api.openai.com"));
        assert!(conf.contains("script-src 'self'"));
        assert!(conf.contains("\"msi\""));
        assert!(conf.contains("\"nsis\""));
        let package = include_str!("../../package.json");
        assert!(package.contains("dist:windows"));
        assert!(package.contains("msi,nsis"));
    }
}

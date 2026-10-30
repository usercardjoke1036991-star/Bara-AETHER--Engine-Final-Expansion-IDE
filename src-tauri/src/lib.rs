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
//!   proceso y los argumentos son literales; no hay shell. `typecheck`
//!   (npm) se corta a los 60 s; `check` y `test` (cargo), a los 120 s.
//! * `judge_auto_patch(path, line, host, patch)` — el núcleo juzga el bloque
//!   **sin escribir**. `∅` nunca se aplica; hace falta `confirm_auto_patch`
//!   tras aceptar el diff (con respaldo en `.bara-backup/`).
//! * `confirm_auto_patch` / `undo_auto_patch` — escriben o restauran tras
//!   aceptación explícita del usuario.
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

use bara_ide::SAMPLE_GENESIS;
use bara_kernel_host::{workspace, KernelHost};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// Explorador y almacén del workspace: la jaula vive en el crate del sidecar
// y este proceso la usa para los archivos. El kernel no corre aquí.

// Clonado de GitHub: URL allowlist y `git clone` sin shell. Ver `src/import.rs`.
mod import;

// Cota de 32 MiB para archivos multimedia elegidos en el diálogo nativo.
mod media;

// Recetas de un clic. El proceso vive aquí, fuera del slice del handler.
mod orchestrate;

// CREATE_NO_WINDOW para hijos en Windows.
mod win_cmd;

// Contexto del editor compartido entre ventanas (main → asistencia).
mod editor_bridge;

// Hilo de reposo. La propuesta la calcula el proceso del kernel.
mod idle_loop;

// Claves de API: sesión o llavero del sistema. El WebView no las lee.
mod secrets;

// Transporte de los proveedores. El destino es una lista cerrada.
mod ai_http;

// Segunda capa de permisos: etiqueta de la ventana frente a lista fija.
mod window_guard;

// Saneado de fugas DSML / tool_call en texto del asistente.
mod tool_leak;

/// Pide una operación al proceso del kernel y devuelve el JSON ya firmado.
fn kernel_call(kernel: &KernelHost, op: &str, args: Value) -> Result<Value, String> {
    kernel.call(op, args)
}

fn kernel_text(kernel: &KernelHost, op: &str, args: Value) -> Result<String, String> {
    match kernel_call(kernel, op, args)? {
        Value::String(text) => Ok(text),
        _ => Err("el kernel devolvió una respuesta que no es texto".to_string()),
    }
}

fn scope_args(workspace: &workspace::ActiveWorkspace) -> Result<Value, String> {
    let (scope, folder_id) = folder_of(workspace)?;
    Ok(json!({ "scope": scope, "folderId": folder_id }))
}

/// Analiza una fuente *Shoresh* en el proceso del kernel.
#[tauri::command]
fn analyze_source(source: String, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "analyze", json!({ "source": source }))
}

/// Analiza un `.bara` de la raíz activa. Fuera de esa jaula no hay lectura.
#[tauri::command]
fn analyze_file(
    path: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    let document = workspace::read(&state.get()?, &path)?;
    kernel_call(&kernel, "analyze", json!({ "source": document.source }))
}

/// Catálogo de raíces semánticas conocidas por el kernel.
#[tauri::command]
fn kernel_catalogue(kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "catalogue", json!({}))
}

/// Documento *Shoresh* de ejemplo, embebido en el binario en tiempo de
/// compilación (no depende del directorio de trabajo).
#[tauri::command]
fn sample_genesis() -> String {
    SAMPLE_GENESIS.to_string()
}

/// Traduce lengua natural a *Shoresh* con el léxico del kernel: el panel de IA
/// muestra así el programa canónico que el propio núcleo compilaría, sin
/// duplicar el diccionario en TypeScript.
#[tauri::command]
fn shoresh_translate(text: String, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "translate", json!({ "text": text }))
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
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    let root = state.get()?;
    kernel_call(
        &kernel,
        "complete",
        json!({ "line": line, "prefix": prefix, "path": path, "root": root }),
    )
}

/// Grafo de la carpeta activa: nodos, aristas y distancia topológica.
#[tauri::command]
fn get_workspace_topology_graph(
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(&kernel, "topology", json!({ "root": state.get()? }))
}

/// Compila, prueba o revisa tipos. El nombre es un catálogo cerrado.
#[tauri::command]
async fn run_workspace_recipe(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    recipe: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<orchestrate::RecipeReport, String> {
    window_guard::require(&window, window_guard::MAIN)?;
    let name = recipe.trim().to_string();
    if name.len() > 16 {
        return Err("la receta no está en el catálogo cerrado".to_string());
    }
    let root = state.get().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let active = root.as_deref().map(std::path::Path::new);
        orchestrate::run(&name, active, Some(app))
    })
    .await
    .map_err(|_| "la receta se interrumpió".to_string())?
}

/// Publica el documento activo de `main` para las ventanas de asistencia.
#[tauri::command]
fn editor_context_publish(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    snapshot: editor_bridge::EditorSnapshot,
    bridge: tauri::State<'_, editor_bridge::EditorBridge>,
) -> Result<editor_bridge::EditorSnapshot, String> {
    window_guard::require(&window, window_guard::MAIN)?;
    bridge.publish(&app, snapshot)
}

/// Último contexto publicado (lo pide `ai-workspace` al abrir).
#[tauri::command]
fn editor_context_get(
    bridge: tauri::State<'_, editor_bridge::EditorBridge>,
) -> Result<editor_bridge::EditorSnapshot, String> {
    bridge.get()
}

/// Lectura de solo lectura para el asistente: cualquier texto del proyecto
/// dentro de la jaula (sin `..`, sin symlinks hacia fuera), cota 1 MiB.
#[tauri::command]
fn workspace_read_project_file(
    window: tauri::WebviewWindow,
    path: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceDocument, String> {
    window_guard::require(&window, window_guard::CHAT)?;
    workspace::read_assistant(&state.get()?, &path)
}

fn auto_patch_args(
    state: &workspace::ActiveWorkspace,
    path: String,
    line: u32,
    host: String,
    patch: String,
) -> Result<Value, String> {
    Ok(json!({
        "root": state.get()?,
        "path": path,
        "line": line,
        "host": host,
        "patch": patch,
    }))
}

/// Juzga un bloque del asistente **sin escribir**. La carpeta es la activa.
#[tauri::command]
fn judge_auto_patch(
    window: tauri::WebviewWindow,
    path: String,
    line: u32,
    host: String,
    patch: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    window_guard::require(&window, window_guard::MAIN)?;
    kernel_call(
        &kernel,
        "judge_patch",
        auto_patch_args(&state, path, line, host, patch)?,
    )
}

/// Escribe un bloque tras aceptación explícita; crea respaldo en `.bara-backup/`.
#[tauri::command]
fn confirm_auto_patch(
    window: tauri::WebviewWindow,
    path: String,
    line: u32,
    host: String,
    patch: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    window_guard::require(&window, window_guard::MAIN)?;
    kernel_call(
        &kernel,
        "confirm_patch",
        auto_patch_args(&state, path, line, host, patch)?,
    )
}

/// Restaura un archivo desde un respaldo relativo bajo `.bara-backup/`.
#[tauri::command]
fn undo_auto_patch(
    window: tauri::WebviewWindow,
    path: String,
    backup_path: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    window_guard::require(&window, window_guard::MAIN)?;
    kernel_call(
        &kernel,
        "undo_patch",
        json!({
            "root": state.get()?,
            "path": path,
            "backup_path": backup_path,
        }),
    )
}

/// Elige un `.gguf` en el diálogo del sistema y guarda sólo su cabecera.
#[tauri::command]
async fn load_local_weights(
    app: tauri::AppHandle,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
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
    let path = path
        .to_str()
        .ok_or_else(|| "la ruta de los pesos no es unicode".to_string())?
        .to_string();
    let kernel = (*kernel).clone();
    tauri::async_runtime::spawn_blocking(move || {
        kernel.call("load_weights", json!({ "path": path }))
    })
    .await
    .map_err(|_| "la carga de pesos se interrumpió".to_string())?
}

/// Resuelve un prompt con los pesos locales. No abre la red.
#[tauri::command]
fn local_complete(prompt: String, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "local_complete", json!({ "prompt": prompt }))
}

/// Propaga un identificador por el grafo de la carpeta activa.
#[tauri::command]
fn transmute_global(
    path: String,
    from: String,
    to: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(
        &kernel,
        "transmute_global",
        json!({ "root": state.get()?, "path": path, "from": from, "to": to }),
    )
}

/// Aviso del hilo de reposo. Vacío si no hay una optimización limpia.
#[tauri::command]
fn idle_proposal(slot: tauri::State<'_, Mutex<idle_loop::IdleBridge>>) -> Result<Value, String> {
    match slot.lock() {
        Ok(guard) => Ok(guard.current().unwrap_or(Value::Null)),
        Err(_) => Err("el reposo no está disponible".to_string()),
    }
}

/// Escribe la optimización si el archivo sigue en `∅`.
#[tauri::command]
fn idle_apply(
    window: tauri::WebviewWindow,
    slot: tauri::State<'_, Mutex<idle_loop::IdleBridge>>,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    window_guard::require(&window, window_guard::IDLE_APPLY)?;
    let notice = match slot.lock() {
        Ok(guard) => guard.current(),
        Err(_) => return Err("el reposo no está disponible".to_string()),
    };
    let Some(notice) = notice else {
        return Ok(Value::Bool(false));
    };
    let wrote = kernel_call(
        &kernel,
        "idle_apply",
        json!({
            "root": state.get()?,
            "path": notice.get("path").and_then(Value::as_str).unwrap_or(""),
            "name": notice.get("name").and_then(Value::as_str).unwrap_or(""),
            "message": notice.get("message").and_then(Value::as_str).unwrap_or(""),
        }),
    )?;
    if let Ok(mut guard) = slot.lock() {
        guard.clear();
    }
    Ok(wrote)
}

/// Descarta el aviso sin tocar el disco.
#[tauri::command]
fn idle_dismiss(slot: tauri::State<'_, Mutex<idle_loop::IdleBridge>>) -> Result<(), String> {
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
    window: tauri::WebviewWindow,
    path: String,
    source: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceDocument, String> {
    window_guard::require(&window, window_guard::WRITE)?;
    workspace::write(&state.get()?, &path, &source)
}

/// Suelta la malla y el oráculo de una carpeta en el proceso del kernel.
fn release_folder(kernel: &KernelHost, path: &str) {
    let _ = kernel.call("forget_scope", json!({ "scope": path }));
}

/// Instala una raíz ya validada por el diálogo o por el clon y purga la expulsada.
fn adopt_root(state: &workspace::ActiveWorkspace, kernel: &KernelHost, root: String) {
    if let Some(evicted) = state.set(root) {
        release_folder(kernel, &evicted);
    }
}

/// Conversa un turno con el oráculo de la carpeta activa.
#[tauri::command]
fn oracle_converse(
    input: String,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    let mut args = scope_args(&workspace)?;
    args["input"] = Value::String(input);
    kernel_call(&kernel, "oracle_converse", args)
}

/// Estado de la sesión de la carpeta activa.
#[tauri::command]
fn oracle_status(
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(&kernel, "oracle_status", scope_args(&workspace)?)
}

/// Turnos conversados en la sesión de la carpeta activa, en orden.
#[tauri::command]
fn oracle_turns(
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(&kernel, "oracle_turns", scope_args(&workspace)?)
}

/// Cierra la sesión de la carpeta activa y devuelve el estado virgen.
#[tauri::command]
fn oracle_reset(
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(&kernel, "oracle_reset", scope_args(&workspace)?)
}

/// Diario temporal `Δ⁻¹` de la carpeta activa.
#[tauri::command]
fn temporal_deltas(
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(&kernel, "temporal_deltas", scope_args(&workspace)?)
}

/// Control temporal: rebobina `Δ⁻¹` hasta `marker` en la carpeta activa.
#[tauri::command]
fn temporal_rollback(
    marker: u64,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    let mut args = scope_args(&workspace)?;
    args["marker"] = json!(marker);
    kernel_call(&kernel, "temporal_rollback", args)
}

/// Biláttice de Belnap completa, tal como la calcula el kernel.
#[tauri::command]
fn belnap_lattice(kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "belnap_lattice", json!({}))
}

/// Clasifica un par `(⊤, ⊥)` con la lógica de Belnap del kernel.
#[tauri::command]
fn belnap_evaluate(
    truth: f64,
    falsity: f64,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(
        &kernel,
        "belnap_evaluate",
        json!({ "truth": truth, "falsity": falsity }),
    )
}

/// **Fase 1** — autopoiesis del AST, valencia de Belnap y puerta ZK.
#[tauri::command]
fn autopoiesis(source: String, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "autopoiesis", json!({ "source": source }))
}

/// **Fase 2** — banco cuántico nativo del documento.
#[tauri::command]
fn quantum_native(source: String, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "quantum", json!({ "source": source }))
}

/// **Fase 2** — sincroniza la malla holográfica y proyecta sus nudos.
#[tauri::command]
fn mesh_sync(
    source: String,
    peers: usize,
    rounds: usize,
    threaded: bool,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(
        &kernel,
        "mesh",
        json!({ "source": source, "peers": peers, "rounds": rounds, "threaded": threaded }),
    )
}

/// **Fase 2** — baja el documento a Metal‑IR para el dispositivo pedido.
#[tauri::command]
fn metal_ir(
    source: String,
    device: Option<String>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(
        &kernel,
        "metal",
        json!({ "source": source, "device": device.unwrap_or_else(|| "cpu".to_string()) }),
    )
}

/// **Fase 2** — diario `Δ⁻¹` del documento y cumbre de su pila de estados.
#[tauri::command]
fn temporal_timeline(
    source: String,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(&kernel, "timeline", json!({ "source": source }))
}

/// **Fase 3** — reparto áureo/Fibonacci de la memoria del documento.
#[tauri::command]
fn fractal_memory(source: String, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "fractal_memory", json!({ "source": source }))
}

/// **Fase 3** — reparto áureo de una lista de anchos arbitraria.
#[tauri::command]
fn fractal_plan(widths: Vec<usize>, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "fractal_plan", json!({ "widths": widths }))
}

/// Contrato del *Visual Builder*: clases, tipos y cotas del lienzo.
#[tauri::command]
fn visual_catalogue(kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "visual_catalogue", json!({}))
}

/// Lienzo de ejemplo del kernel, para el editor del panel.
#[tauri::command]
fn visual_sample(kernel: tauri::State<'_, KernelHost>) -> Result<String, String> {
    kernel_text(&kernel, "visual_sample", json!({}))
}

/// Traduce, valida y **firma** un lienzo JSON estricto.
#[tauri::command]
fn visual_build(blueprint: String, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "visual_build", json!({ "blueprint": blueprint }))
}

/// Compone varios lienzos en un único ADN firmado.
#[tauri::command]
fn visual_compose(
    blueprints: Vec<String>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(
        &kernel,
        "visual_compose",
        json!({ "blueprints": blueprints }),
    )
}

/// Reconstruye el lienzo en el kernel y sólo entonces entrega el `.bara`.
#[tauri::command]
fn visual_emit(blueprint: String, kernel: tauri::State<'_, KernelHost>) -> Result<Value, String> {
    kernel_call(&kernel, "visual_emit", json!({ "blueprint": blueprint }))
}

/// Emisión de una composición: mismo sello, el orden de los lienzos importa.
#[tauri::command]
fn visual_emit_composed(
    blueprints: Vec<String>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<Value, String> {
    kernel_call(
        &kernel,
        "visual_emit_composed",
        json!({ "blueprints": blueprints }),
    )
}

/// **Fase 5** — contrato canónico del puente kernel → IDE.
#[tauri::command]
fn bridge_manifest(kernel: tauri::State<'_, KernelHost>) -> Result<String, String> {
    kernel_text(&kernel, "bridge_manifest", json!({}))
}

/// **Fase 5** — instantánea de sólo lectura del kernel sobre el documento.
#[tauri::command]
fn bridge_snapshot(source: String, kernel: tauri::State<'_, KernelHost>) -> Result<String, String> {
    kernel_text(&kernel, "bridge_snapshot", json!({ "source": source }))
}

/// Manifiesto ontológico canónico + huella de identidad del puente.
#[tauri::command]
fn get_system_manifest(kernel: tauri::State<'_, KernelHost>) -> Result<String, String> {
    kernel_text(&kernel, "system_manifest", json!({}))
}

/// Marco cognitivo completo (`NeuralFrame::json`).
#[tauri::command]
fn get_neural_frame(
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<String, String> {
    kernel_text(&kernel, "neural_frame", scope_args(&workspace)?)
}

/// Volcado de la caja negra limitado a los tramos de la carpeta activa.
#[tauri::command]
fn get_flight_recorder_logs(
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<String, String> {
    kernel_text(&kernel, "flight_logs", scope_args(&workspace)?)
}

/// Transmuta código/texto externo, lo audita y lo indexa si es admisible.
#[tauri::command(rename_all = "snake_case")]
fn transmute_input(
    source_code: String,
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<String, String> {
    let mut args = scope_args(&workspace)?;
    args["source"] = Value::String(source_code);
    kernel_text(&kernel, "transmute_input", args)
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

/// La ventana de asistencia pide un diff en `main` (sin escribir).
#[tauri::command]
fn propose_editor_patch(app: tauri::AppHandle, patch: String) -> Result<(), String> {
    let text = patch.trim();
    if text.is_empty() {
        return Err("el parche está vacío".to_string());
    }
    if text.len() > 32 * 1024 {
        return Err("el parche supera 32 KiB".to_string());
    }
    app.emit("assistant-propose-patch", json!({ "patch": text }))
        .map_err(|err| err.to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    Ok(())
}

/// Abre el inspector web. Requiere `--features devtools` (p. ej. `tauri dev`).
#[tauri::command]
fn open_devtools_window(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(feature = "devtools")]
    {
        window.open_devtools();
        Ok(())
    }
    #[cfg(not(feature = "devtools"))]
    {
        let _ = window;
        Err("DevTools desactivadas en este binario (release o sin feature)".to_string())
    }
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
    app: tauri::AppHandle,
    id: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
) -> Result<workspace::WorkspaceShelf, String> {
    let shelf = state.activate(id.trim())?;
    if let Ok(root) = state.get() {
        let _ = app.emit(
            "workspace-root-changed",
            json!({ "root": root, "reason": "activate" }),
        );
    }
    Ok(shelf)
}

/// Cierra una carpeta del estante. La última permanece.
#[tauri::command]
fn workspace_close_root(
    id: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<workspace::WorkspaceShelf, String> {
    let (path, shelf) = state.release(id.trim())?;
    release_folder(&kernel, &path);
    Ok(shelf)
}

/// Transmuta el árbol de la carpeta activa. La ruta no la elige el WebView.
#[tauri::command]
fn transmute_workspace(
    workspace: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<String, String> {
    kernel_text(
        &kernel,
        "transmute_workspace",
        json!({ "root": workspace.get()? }),
    )
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
    kernel: tauri::State<'_, KernelHost>,
) -> Result<workspace::WorkspaceTree, String> {
    let folder = pick_folder(&app, "Abrir carpeta del workspace")?;
    let tree = workspace::tree(&folder.display().to_string())?;
    adopt_root(&state, &kernel, tree.root.clone());
    let _ = app.emit(
        "workspace-root-changed",
        json!({ "root": tree.root.clone(), "reason": "open" }),
    );
    Ok(tree)
}

/// Clona un repositorio de GitHub dentro de la carpeta que elija el diálogo.
///
/// Primero se valida la URL. Después el usuario elige el directorio padre.
/// `git` corre con argumentos fijos, sin shell. Al terminar, ese clon es el
/// workspace activo y el árbol ya viene sin `target/`, `node_modules/` ni `.git/`.
#[tauri::command]
async fn github_clone(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    url: String,
    state: tauri::State<'_, workspace::ActiveWorkspace>,
    kernel: tauri::State<'_, KernelHost>,
) -> Result<workspace::WorkspaceTree, String> {
    window_guard::require(&window, window_guard::MAIN)?;
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
    adopt_root(&state, &kernel, tree.root.clone());
    let _ = app.emit(
        "workspace-root-changed",
        json!({ "root": tree.root.clone(), "reason": "clone" }),
    );
    Ok(tree)
}

/// Guarda la clave del proveedor. `remember` la deja en el llavero del sistema.
#[tauri::command]
fn ai_key_save(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Mutex<secrets::Session>>,
    provider: String,
    secret: String,
    remember: bool,
) -> Result<(), String> {
    window_guard::require(&window, window_guard::CHAT)?;
    let mut session = state
        .lock()
        .map_err(|_| "el llavero está ocupado".to_string())?;
    secrets::save(&mut session, &secrets::System, &provider, &secret, remember)
}

/// `true` si hay clave. El secreto no viaja en la respuesta.
#[tauri::command]
fn ai_key_exists(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Mutex<secrets::Session>>,
    provider: String,
) -> Result<bool, String> {
    window_guard::require(&window, window_guard::CHAT)?;
    let session = state
        .lock()
        .map_err(|_| "el llavero está ocupado".to_string())?;
    secrets::exists(&session, &secrets::System, &provider)
}

/// Borra la clave de la sesión y del llavero.
#[tauri::command]
fn ai_key_delete(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Mutex<secrets::Session>>,
    provider: String,
) -> Result<(), String> {
    window_guard::require(&window, window_guard::CHAT)?;
    let mut session = state
        .lock()
        .map_err(|_| "el llavero está ocupado".to_string())?;
    secrets::delete(&mut session, &secrets::System, &provider)
}

/// Llama al proveedor. La clave la pone este proceso; la respuesta ya viene limpia.
#[tauri::command]
async fn ai_exchange(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Mutex<secrets::Session>>,
    provider: String,
    url: String,
    method: String,
    body: Option<String>,
) -> Result<ai_http::Exchange, String> {
    window_guard::require(&window, window_guard::CHAT)?;
    let secret = {
        let session = state
            .lock()
            .map_err(|_| "el llavero está ocupado".to_string())?;
        secrets::lookup(&session, &secrets::System, &provider)?
    };
    let payload = body.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        ai_http::exchange(&provider, &url, &method, &payload, &secret)
    })
    .await
    .map_err(|_| "la llamada al proveedor se interrumpió".to_string())?
}

/// Sonda DNS→TCP→TLS→HTTP→modelos. La clave no vuelve al WebView.
#[tauri::command]
async fn ai_probe_connection(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Mutex<secrets::Session>>,
    provider: String,
    base_url: String,
) -> Result<ai_http::ProbeReport, String> {
    window_guard::require(&window, window_guard::CHAT)?;
    let secret = {
        let session = state
            .lock()
            .map_err(|_| "el llavero está ocupado".to_string())?;
        secrets::lookup(&session, &secrets::System, &provider)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        Ok(ai_http::probe_connection(&provider, &base_url, &secret))
    })
    .await
    .map_err(|_| "la sonda se interrumpió".to_string())?
}

/// Diálogo de carpeta. `cancelado` es el contrato que la interfaz no pinta en rojo.
/// Estado del proceso hijo: `activo`, `reiniciando` o `caído`.
#[tauri::command]
fn kernel_host_status(kernel: tauri::State<'_, KernelHost>) -> String {
    kernel.status().label().to_string()
}

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

/// Arranca la ventana del IDE. El kernel corre en un proceso hijo.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kernel = KernelHost::boot();
    if let Err(error) = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(kernel)
        .manage(workspace::ActiveWorkspace::bootstrap())
        .manage(Mutex::new(idle_loop::IdleBridge::new()))
        .manage(Mutex::new(secrets::Session::default()))
        .manage(editor_bridge::EditorBridge::new())
        .setup(|app| {
            let handle = app.handle().clone();
            app.state::<KernelHost>().listen(move |status| {
                let _ = handle.emit("kernel-host", status);
            });
            let _ = app
                .handle()
                .emit("kernel-host", app.state::<KernelHost>().status().label());
            idle_loop::start(app.handle().clone());
            // DevTools: en debug (o `--features devtools`) el front puede abrirlas
            // con F12 / Ctrl+Shift+I. Release sin la feature no enlaza el inspector.
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
            propose_editor_patch,
            open_devtools_window,
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
            workspace_read_project_file,
            editor_context_publish,
            editor_context_get,
            run_workspace_recipe,
            judge_auto_patch,
            confirm_auto_patch,
            undo_auto_patch,
            load_local_weights,
            local_complete,
            transmute_global,
            idle_proposal,
            idle_apply,
            idle_dismiss,
            ai_key_save,
            ai_key_exists,
            ai_key_delete,
            ai_exchange,
            ai_probe_connection,
            kernel_host_status
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Bara IDE: no se pudo iniciar la ventana (Tauri): {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod ipc_boundary {
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
        assert!(handler.contains("propose_editor_patch"));
        assert!(handler.contains("open_devtools_window"));
        assert!(handler.contains("workspace_activate"));
        assert!(handler.contains("transmute_workspace"));
        assert!(handler.contains("inspect_media_dialog"));
        assert!(handler.contains("get_local_completions"));
        assert!(handler.contains("get_workspace_topology_graph"));
        assert!(handler.contains("workspace_source_text"));
        assert!(handler.contains("workspace_read_project_file"));
        assert!(handler.contains("editor_context_publish"));
        assert!(handler.contains("editor_context_get"));
        assert!(handler.contains("run_workspace_recipe"));
        assert!(handler.contains("judge_auto_patch"));
        assert!(handler.contains("confirm_auto_patch"));
        assert!(handler.contains("undo_auto_patch"));
        assert!(handler.contains("load_local_weights"));
        assert!(handler.contains("local_complete"));
        assert!(handler.contains("transmute_global"));
        assert!(handler.contains("idle_proposal"));
        assert!(handler.contains("idle_apply"));
        assert!(handler.contains("idle_dismiss"));
        assert!(handler.contains("ai_key_save"));
        assert!(handler.contains("ai_key_exists"));
        assert!(handler.contains("ai_key_delete"));
        assert!(handler.contains("ai_exchange"));
        assert!(handler.contains("ai_probe_connection"));
        assert!(handler.contains("kernel_host_status"));
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
            "fn workspace_read_project_file(",
            "fn editor_context_publish(",
            "fn editor_context_get(",
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
    fn las_capabilities_acotan_ventana_a_ventana() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut seen = std::collections::BTreeSet::new();
        for entry in std::fs::read_dir(&dir).expect("capabilities") {
            let entry = entry.expect("entrada");
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("leer");
            assert!(
                !text.contains("\"*\""),
                "{} no puede usar comodines",
                path.display()
            );
            assert!(
                !text.contains("shell:"),
                "{} no puede abrir el plugin shell",
                path.display()
            );
            let value: serde_json::Value = serde_json::from_str(&text).expect("json");
            let windows = value["windows"]
                .as_array()
                .expect("windows")
                .iter()
                .map(|item| item.as_str().expect("label").to_string())
                .collect::<Vec<_>>();
            assert_eq!(windows.len(), 1, "{}: una sola ventana", path.display());
            let label = windows[0].as_str();
            assert!(seen.insert(label.to_string()), "ventana duplicada: {label}");
            let permissions = value["permissions"]
                .as_array()
                .expect("permissions")
                .iter()
                .map(|item| item.as_str().unwrap_or("").to_string())
                .collect::<Vec<_>>();
            let has = |id: &str| permissions.iter().any(|item| item == id);
            let has_llavero =
                has("llavero") || has("allow-ai-key-save") || has("allow-ai-exchange");
            let has_receta = has("recetas") || has("allow-run-workspace-recipe");
            let has_github = has("github") || has("allow-github-clone");
            let has_write = has("allow-workspace-write-document") || has("archivos");
            if label == "topology" || label == "autopoiesis" || label == "telemetry" {
                assert!(!has_llavero, "{label} no toca el llavero");
                assert!(!has_receta, "{label} no lanza recetas");
                assert!(!has_github, "{label} no clona");
                assert!(!has_write, "{label} no escribe el workspace");
            }
            if label == "ai-workspace" {
                assert!(has_llavero, "la asistencia necesita el llavero");
                assert!(!has_receta, "la asistencia no lanza recetas");
                assert!(!has_github, "la asistencia no clona");
                // A3: Ctrl+S / edición en el escritorio de asistencia.
                assert!(has_write, "la asistencia debe poder guardar el workspace");
            }
            if label == "main" {
                assert!(has_llavero && has_receta && has_github && has_write);
            }
        }
        for expected in [
            "main",
            "topology",
            "autopoiesis",
            "telemetry",
            "ai-workspace",
        ] {
            assert!(seen.contains(expected), "falta capability de {expected}");
        }
    }

    #[test]
    fn la_csp_no_abre_https_generico() {
        let conf = include_str!("../tauri.conf.json");
        assert!(!conf.contains("\"csp\": null"));
        for key in ["csp", "devCsp"] {
            let value = csp_value(conf, key);
            let connect = connect_src(value);
            for token in connect.split_whitespace().skip(1) {
                assert!(
                    origen_https_concreto(token),
                    "{key}: esquema https genérico en connect-src: {token}"
                );
            }
        }
        let production = csp_value(conf, "csp");
        for host in [
            "https://api.anthropic.com",
            "https://api.openai.com",
            "https://api.deepseek.com",
        ] {
            assert!(
                !production.contains(host),
                "el WebView no llama a {host}; lo hace el proceso"
            );
        }
        assert!(!production.contains("https:"));
        assert!(!origen_https_concreto("https:"));
        assert!(!origen_https_concreto("https://"));
        assert!(!origen_https_concreto("https://*"));
        assert!(origen_https_concreto("https://api.deepseek.com"));
        assert!(origen_https_concreto("ipc:"));
        assert!(production.contains("script-src 'self'"));
        assert!(conf.contains("\"msi\""));
        assert!(conf.contains("\"nsis\""));
        assert!(conf.contains("binaries/bara-kernel-host"));
        let package = include_str!("../../package.json");
        assert!(package.contains("dist:windows"));
        assert!(package.contains("msi,nsis"));
    }

    /// Valor JSON de `"csp"` o `"devCsp"`. El archivo no es un esquema suelto.
    fn csp_value<'a>(conf: &'a str, key: &str) -> &'a str {
        let needle = format!("\"{key}\": \"");
        let Some(at) = conf.find(&needle) else {
            panic!("falta {key}");
        };
        let rest = &conf[at + needle.len()..];
        let Some(end) = rest.find('"') else {
            panic!("{key} sin cierre");
        };
        &rest[..end]
    }

    fn connect_src(csp: &str) -> &str {
        csp.split(';')
            .map(str::trim)
            .find(|part| part.starts_with("connect-src "))
            .unwrap_or_else(|| panic!("falta connect-src"))
    }

    /// `https://api.ejemplo.com` sí. `https:`, `https://` y `https://*` no.
    /// Un token que no es https (ipc, localhost) pasa.
    fn origen_https_concreto(token: &str) -> bool {
        let Some(host) = token.strip_prefix("https:") else {
            return true;
        };
        let Some(host) = host.strip_prefix("//") else {
            return false;
        };
        let host = host.split(['/', ':', '?']).next().unwrap_or("");
        !host.is_empty() && !host.contains('*') && host.contains('.')
    }
}

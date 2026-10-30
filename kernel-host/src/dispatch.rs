//! Lista cerrada de operaciones. Cada una llama al kernel con los argumentos
//! de la petición y nada más. No hay red ni shells.

#![forbid(unsafe_code)]

use std::path::Path;
use std::sync::Mutex;

use serde_json::{json, Value};

use crate::auto_apply;
use crate::completion;
use crate::global_transmute;
use crate::graph;
use crate::idle_worker::{self, IdleNotice};
use crate::local_infer;
use crate::telemetry::{self, CognitiveShelf, OracleShelf};

/// Tope de una línea de entrada. Por encima, el hijo no la interpreta.
pub const MAX_REQUEST: usize = 32 * 1024 * 1024;

/// Estado que vive en el hijo. Si el proceso muere, se pierde y el IDE lo
/// vuelve a crear vacío.
pub struct World {
    cognition: Mutex<CognitiveShelf>,
    oracles: OracleShelf,
    completions: completion::CompletionCache,
    local: local_infer::LocalSlot,
}

impl World {
    pub fn new() -> Self {
        Self {
            cognition: Mutex::new(CognitiveShelf::new()),
            oracles: OracleShelf::new(),
            completions: completion::CompletionCache::new(),
            local: local_infer::LocalSlot::new(),
        }
    }
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}

/// Traduce una línea ya recortada a la línea de respuesta.
pub fn dispatch_line(world: &mut World, line: &str) -> String {
    let request: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return fail(0, "la petición no es JSON"),
    };
    let id = request.get("id").and_then(Value::as_u64).unwrap_or(0);
    let op = request.get("op").and_then(Value::as_str).unwrap_or("");
    let args = request.get("args").cloned().unwrap_or_else(|| json!({}));
    match handle(world, op, &args) {
        Ok(data) => ok(id, &data),
        Err(error) => fail(id, &error),
    }
}

fn ok(id: u64, data: &Value) -> String {
    json!({ "id": id, "ok": true, "data": data }).to_string()
}

fn fail(id: u64, err: &str) -> String {
    json!({ "id": id, "ok": false, "err": err }).to_string()
}

fn handle(world: &mut World, op: &str, args: &Value) -> Result<Value, String> {
    #[cfg(feature = "faults")]
    if let Some(value) = fault(op)? {
        return Ok(value);
    }
    match op {
        "analyze" => value_of(bara_ide::analyze(text(args, "source")?)),
        "catalogue" => value_of(bara_ide::catalogue()),
        "translate" => value_of(bara_ide::translate(text(args, "text")?)),
        "belnap_lattice" => value_of(bara_ide::belnap_lattice()),
        "belnap_evaluate" => value_of(bara_ide::belnap_evaluate(
            number(args, "truth")?,
            number(args, "falsity")?,
        )),
        "autopoiesis" => value_of(bara_ide::autopoiesis(text(args, "source")?)),
        "quantum" => value_of(bara_ide::quantum_register(text(args, "source")?)),
        "mesh" => value_of(bara_ide::mesh_status(
            text(args, "source")?,
            count_usize(args, "peers")?,
            count_usize(args, "rounds")?,
            flag(args, "threaded")?,
        )),
        "metal" => value_of(bara_ide::metal_program(
            text(args, "source")?,
            args.get("device").and_then(Value::as_str).unwrap_or("cpu"),
        )),
        "timeline" => value_of(bara_ide::timeline(text(args, "source")?)),
        "fractal_memory" => value_of(bara_ide::fractal_memory(text(args, "source")?)),
        "fractal_plan" => value_of(bara_ide::fractal_plan(&widths(args)?)),
        "visual_catalogue" => value_of(bara_ide::visual_catalogue()),
        "visual_sample" => Ok(Value::String(bara_ide::visual_sample())),
        "visual_build" => result_of(bara_ide::visual_build(text(args, "blueprint")?)),
        "visual_compose" => result_of(bara_ide::visual_compose(&strings(args, "blueprints")?)),
        "visual_emit" => result_of(bara_ide::visual_emit(text(args, "blueprint")?)),
        "visual_emit_composed" => result_of(bara_ide::visual_emit_composed(&strings(
            args,
            "blueprints",
        )?)),
        "bridge_manifest" => Ok(Value::String(bara_ide::bridge_manifest())),
        "bridge_snapshot" => text_result(bara_ide::bridge_snapshot(text(args, "source")?)),
        "system_manifest" => text_result(telemetry::system_manifest()),
        "neural_frame" => text_result(telemetry::neural_frame(
            &world.cognition,
            text(args, "scope")?,
        )),
        "flight_logs" => text_result(telemetry::flight_recorder_logs(
            &world.cognition,
            text(args, "scope")?,
            text(args, "folderId")?,
        )),
        "transmute_input" => text_result(telemetry::transmute_input(
            &world.cognition,
            text(args, "scope")?,
            text(args, "source")?,
        )),
        "oracle_converse" => oracle_converse(world, args),
        "oracle_status" => {
            let scope = text(args, "scope")?;
            let mut status = world.oracles.session(scope).status();
            status.workspace_id = text(args, "folderId")?.to_string();
            value_of(status)
        }
        "oracle_turns" => value_of(world.oracles.session(text(args, "scope")?).turns()),
        "oracle_reset" => {
            let scope = text(args, "scope")?;
            let session = world.oracles.session(scope);
            session.reset();
            let mut status = session.status();
            status.workspace_id = text(args, "folderId")?.to_string();
            value_of(status)
        }
        "temporal_deltas" => value_of(world.oracles.session(text(args, "scope")?).deltas()),
        "temporal_rollback" => oracle_rollback(world, args),
        "forget_scope" => {
            let scope = text(args, "scope")?;
            if let Ok(mut shelf) = world.cognition.lock() {
                shelf.forget(scope);
            }
            world.oracles.forget(scope);
            Ok(Value::Null)
        }
        "complete" => {
            let root = text(args, "root")?;
            let labels = world
                .cognition
                .lock()
                .map_err(|_| "la malla cognitiva no está disponible".to_string())?
                .indexed_labels(root);
            result_of(completion::complete(
                count_u32(args, "line")?,
                text(args, "prefix")?,
                text(args, "path")?,
                root,
                &labels,
                &mut world.completions,
            ))
        }
        "topology" => result_of(graph::build(text(args, "root")?)),
        "judge_patch" => result_of(auto_apply::judge(
            text(args, "root")?,
            text(args, "path")?,
            count_u32(args, "line")?,
            text(args, "host")?,
            text(args, "patch")?,
        )),
        "confirm_patch" => result_of(auto_apply::confirm(
            text(args, "root")?,
            text(args, "path")?,
            count_u32(args, "line")?,
            text(args, "host")?,
            text(args, "patch")?,
        )),
        "undo_patch" => result_of(auto_apply::undo(
            text(args, "root")?,
            text(args, "path")?,
            text(args, "backup_path")?,
        )),
        "transmute_global" => result_of(global_transmute::propagate(
            text(args, "root")?,
            text(args, "path")?,
            text(args, "from")?,
            text(args, "to")?,
        )),
        "transmute_workspace" => text_result(transmute_dir(text(args, "root")?)),
        "load_weights" => {
            let model = local_infer::load_file(Path::new(text(args, "path")?))?;
            let view = local_infer::WeightView::from(&model);
            world.local.install(model);
            value_of(view)
        }
        "local_complete" => {
            let prompt = text(args, "prompt")?;
            let reply = match world.local.card() {
                Some(model) => local_infer::complete(model, prompt),
                None => return Err("no hay pesos locales cargados".to_string()),
            };
            value_of(reply)
        }
        "idle_seek" => match idle_worker::seek(text(args, "root")?) {
            Some(notice) => value_of(notice),
            None => Ok(Value::Null),
        },
        "idle_apply" => {
            let notice = IdleNotice {
                path: text(args, "path")?.to_string(),
                name: text(args, "name")?.to_string(),
                message: text(args, "message")?.to_string(),
            };
            value_of(idle_worker::apply(text(args, "root")?, &notice)?)
        }
        _ => Err("operación no admitida".to_string()),
    }
}

#[cfg(feature = "faults")]
fn fault(op: &str) -> Result<Option<Value>, String> {
    match op {
        "fault-panic" => panic!("pánico de prueba del sidecar"),
        "fault-loop" =>
        {
            #[allow(clippy::empty_loop)]
            loop {}
        }
        "fault-huge" => Ok(Some(Value::String("x".repeat(17 * 1024 * 1024)))),
        _ => Ok(None),
    }
}

fn oracle_converse(world: &mut World, args: &Value) -> Result<Value, String> {
    let scope = text(args, "scope")?;
    let from = bara::flight_recorder::mark();
    let mut turn = world.oracles.session(scope).converse(text(args, "input")?);
    let to = bara::flight_recorder::mark();
    if let Ok(mut shelf) = world.cognition.lock() {
        shelf.note_span(scope, from, to);
    }
    turn.status.workspace_id = text(args, "folderId")?.to_string();
    value_of(turn)
}

fn oracle_rollback(world: &mut World, args: &Value) -> Result<Value, String> {
    let scope = text(args, "scope")?;
    let marker = count(args, "marker")?;
    let from = bara::flight_recorder::mark();
    let mut turn = world.oracles.session(scope).rollback(marker);
    let to = bara::flight_recorder::mark();
    if let Ok(mut shelf) = world.cognition.lock() {
        shelf.note_span(scope, from, to);
    }
    turn.status.workspace_id = text(args, "folderId")?.to_string();
    value_of(turn)
}

fn transmute_dir(root: &str) -> Result<String, String> {
    let project = bara::transmute_engine::transmute_workspace_dir(Path::new(root))?;
    let distance = if project.topology.nearest == u16::MAX {
        Value::Null
    } else {
        json!(project.topology.nearest)
    };
    Ok(json!({
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

fn text<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("falta {key}"))
}

fn number(args: &Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("falta {key}"))
}

fn count_u32(args: &Value, key: &str) -> Result<u32, String> {
    u32::try_from(count(args, key)?).map_err(|_| format!("{key} no cabe en la petición"))
}

fn count_usize(args: &Value, key: &str) -> Result<usize, String> {
    usize::try_from(count(args, key)?).map_err(|_| format!("{key} no cabe en la petición"))
}

fn count(args: &Value, key: &str) -> Result<u64, String> {
    args.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("falta {key}"))
}

fn flag(args: &Value, key: &str) -> Result<bool, String> {
    args.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("falta {key}"))
}

fn strings(args: &Value, key: &str) -> Result<Vec<String>, String> {
    let list = args
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("falta {key}"))?;
    list.iter()
        .map(|item| {
            item.as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("{key} no es una lista de textos"))
        })
        .collect()
}

fn widths(args: &Value) -> Result<Vec<usize>, String> {
    let list = args
        .get("widths")
        .and_then(Value::as_array)
        .ok_or_else(|| "falta widths".to_string())?;
    list.iter()
        .map(|item| {
            item.as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .ok_or_else(|| "widths no es una lista de anchos".to_string())
        })
        .collect()
}

fn value_of(value: impl serde::Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|_| "no se pudo serializar la respuesta".to_string())
}

fn result_of<T: serde::Serialize>(value: Result<T, String>) -> Result<Value, String> {
    value_of(value?)
}

fn text_result(value: Result<String, String>) -> Result<Value, String> {
    Ok(Value::String(value?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_operacion_ajena_no_entra() {
        let mut world = World::new();
        let line = dispatch_line(&mut world, r#"{"id":7,"op":"shell","args":{"cmd":"x"}}"#);
        assert!(line.contains("\"ok\":false"));
        assert!(line.contains("no admitida"));
        assert!(line.contains("\"id\":7"));
    }

    #[test]
    fn olvidar_vacia_la_malla_y_el_oraculo() {
        let mut world = World::new();
        {
            let mut shelf = world.cognition.lock().expect("malla");
            shelf.note_span("carpeta-b", 3, 4);
            shelf.note_span("carpeta-a", 1, 2);
        }
        let _ = world.oracles.session("carpeta-b").converse("hola");
        let line = dispatch_line(
            &mut world,
            r#"{"id":1,"op":"forget_scope","args":{"scope":"carpeta-b"}}"#,
        );
        assert!(line.contains("\"ok\":true"));
        assert!(world
            .cognition
            .lock()
            .expect("malla")
            .spans_of("carpeta-b")
            .is_empty());
        assert!(!world
            .cognition
            .lock()
            .expect("malla")
            .spans_of("carpeta-a")
            .is_empty());
        assert!(world.oracles.session("carpeta-b").turns().is_empty());
    }
}

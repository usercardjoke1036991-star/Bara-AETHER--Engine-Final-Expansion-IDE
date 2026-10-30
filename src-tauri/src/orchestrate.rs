//! Recetas de un clic. El catálogo es cerrado: el WebView elige un nombre y
//! el proceso nace con un programa y unos argumentos literales. No hay
//! intérprete de shell ni una cadena de comando armada por el cliente.
//!
//! El directorio de trabajo es la carpeta abierta, y sólo si ella misma
//! contiene el ancla (`package.json` o `Cargo.toml`). No se sube a un padre:
//! un `package.json` ancestro no debe ejecutar `npm run typecheck`.
//!
//! En Windows `typecheck` arranca `cmd.exe` con argv fijo (`/d /s /c npm run
//! typecheck`) porque CreateProcess no ejecuta un `.cmd`. Al vencer el plazo
//! se mata el árbol: `taskkill /F /T` en Windows y el grupo de procesos en
//! Unix. Los plazos siguen en 60 s (npm) y 120 s (cargo).

#![forbid(unsafe_code)]

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use bara::autopoietic::BelnapValue;
use bara::log_lattice::{observe_log_line, status_key};
use bara_kernel_host::{new_group, terminate_tree};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::win_cmd;

/// `npm run typecheck` no debería pasar de un minuto.
const IDE_RECIPE_LIMIT: Duration = Duration::from_secs(60);

/// `cargo check` en frío supera los 30 s. Dos minutos cubren una compilación
/// corta; si sigue vivo, se mata y el panel lo cuenta como tiempo agotado.
const CARGO_RECIPE_LIMIT: Duration = Duration::from_secs(120);

/// Tope de bytes que vuelven al panel. El resto se descarta.
const MAX_OUTPUT: usize = 48 * 1024;

/// Tope de líneas clasificadas.
const MAX_LINES: usize = 160;

/// Una línea ya clasificada por el bilátice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeLine {
    /// Texto recortado de la salida del proceso.
    pub text: String,
    /// `true`, `false`, `both` o `neither`.
    pub status: &'static str,
    /// Glifo de Belnap.
    pub glyph: &'static str,
}

/// Informe de una receta. El código de salida viaja dentro: un fallo de
/// compilación no es un error de IPC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeReport {
    pub recipe: String,
    pub exit_code: i32,
    pub lines: Vec<RecipeLine>,
    pub true_count: u32,
    pub false_count: u32,
    pub both_count: u32,
    pub neither_count: u32,
    pub truncated: bool,
    /// El proceso superó el plazo de su receta y fue terminado.
    pub timed_out: bool,
}

/// Programa y argumentos literales. `cwd` es el workspace o el IDE, nunca
/// una ruta llegada por IPC.
struct Spec {
    program: &'static str,
    args: &'static [&'static str],
    ide: bool,
}

/// Resuelve un nombre del catálogo. Cualquier otra cadena se rechaza antes
/// de crear un proceso.
fn spec(recipe: &str) -> Result<Spec, String> {
    match recipe {
        "check" => Ok(Spec {
            program: "cargo",
            args: &["check", "-p", "bara", "--offline"],
            ide: false,
        }),
        "test" => Ok(Spec {
            program: "cargo",
            args: &[
                "test",
                "-p",
                "bara",
                "--lib",
                "el_conflicto_complejo_ensena_a_sellar",
                "--offline",
            ],
            ide: false,
        }),
        "typecheck" => Ok(typecheck_spec()),
        _ => Err("la receta no está en el catálogo cerrado".to_string()),
    }
}

/// `npm.cmd` no es un ejecutable PE: CreateProcess lo rechaza. `cmd.exe` sí,
/// y el argv es literal (no llega texto del WebView).
fn typecheck_spec() -> Spec {
    if cfg!(windows) {
        Spec {
            program: "cmd.exe",
            args: &["/d", "/s", "/c", "npm", "run", "typecheck"],
            ide: true,
        }
    } else {
        Spec {
            program: "npm",
            args: &["run", "typecheck"],
            ide: true,
        }
    }
}

fn workspace_dir() -> Result<PathBuf, String> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    anchored(&dir, "Cargo.toml")
}

fn ide_dir() -> Result<PathBuf, String> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    anchored(&dir, "package.json")
}

fn recipe_dir(ide: bool, active: Option<&Path>) -> Result<PathBuf, String> {
    let anchor = if ide { "package.json" } else { "Cargo.toml" };
    if let Some(root) = active {
        return anchored(root, anchor).map_err(|_| {
            if ide {
                "la carpeta abierta no contiene package.json".to_string()
            } else {
                "la carpeta abierta no contiene Cargo.toml".to_string()
            }
        });
    }
    // Sin carpeta abierta: la ruta grabada al compilar. En un MSI esa ruta
    // no existe y la receta pide abrir el proyecto, sin buscar ancestros.
    let compiled = if ide { ide_dir() } else { workspace_dir() };
    compiled.map_err(|_| {
        if ide {
            "abre la carpeta del IDE: hace falta package.json".to_string()
        } else {
            "abre la carpeta del kernel: hace falta Cargo.toml".to_string()
        }
    })
}

/// Canonicaliza y exige el ancla. Así un enlace no recoloca el directorio
/// de trabajo en silencio.
fn anchored(dir: &Path, anchor: &str) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(dir)
        .map_err(|_| "el directorio de la receta no existe".to_string())?;
    if !canonical.join(anchor).is_file() {
        return Err("el directorio de la receta no es el workspace esperado".to_string());
    }
    Ok(canonical)
}

/// Clasifica con el bilátice del núcleo. El glifo sale de [`BelnapValue::glyph`].
fn classify(line: &str) -> (&'static str, &'static str) {
    let value = observe_log_line(line);
    (status_key(value), value.glyph())
}

struct Driven {
    code: i32,
    blob: String,
    timed_out: bool,
    truncated: bool,
}

/// Emite una línea cruda al panel mientras corre la receta.
fn emit_recipe_chunk(app: &Option<AppHandle>, stream: &str, text: &str) {
    let Some(handle) = app else {
        return;
    };
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            continue;
        }
        let _ = handle.emit(
            "recipe-output",
            serde_json::json!({ "stream": stream, "text": clip(trimmed) }),
        );
    }
}

/// Lee un pipe y, si hay AppHandle, publica trozos en vivo.
fn drain_pipe_live(
    pipe: impl Read + Send + 'static,
    app: Option<AppHandle>,
    stream: &'static str,
) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut taken = pipe.take(MAX_OUTPUT as u64);
        let mut buf = Vec::new();
        let mut chunk = [0u8; 512];
        let mut pending = String::new();
        loop {
            match taken.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    pending.push_str(&String::from_utf8_lossy(&chunk[..n]));
                    while let Some(at) = pending.find('\n') {
                        let line = pending[..at].to_string();
                        pending = pending[at + 1..].to_string();
                        emit_recipe_chunk(&app, stream, &line);
                    }
                }
                Err(_) => break,
            }
        }
        if !pending.is_empty() {
            emit_recipe_chunk(&app, stream, &pending);
        }
        buf
    })
}

/// Espera `limit`. Si el hijo sigue vivo, mata su árbol y devuelve lo ya leído.
fn drive(
    command: &mut Command,
    limit: Duration,
    app: Option<AppHandle>,
) -> Result<Driven, String> {
    new_group(command);
    win_cmd::hide_console(command);
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|_| "no se pudo lanzar la receta".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "la receta no abrió su salida".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "la receta no abrió su salida".to_string())?;
    let out_handle = drain_pipe_live(stdout, app.clone(), "stdout");
    let err_handle = drain_pipe_live(stderr, app.clone(), "stderr");
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() >= limit => {
                timed_out = true;
                terminate_tree(&mut child);
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(_) => {
                terminate_tree(&mut child);
                return Err("la receta se interrumpió".to_string());
            }
        }
    };
    let stdout_bytes = out_handle.join().unwrap_or_default();
    let stderr_bytes = err_handle.join().unwrap_or_default();
    let mut blob = String::new();
    blob.push_str(&String::from_utf8_lossy(&stdout_bytes));
    blob.push_str(&String::from_utf8_lossy(&stderr_bytes));
    let truncated = blob.len() > MAX_OUTPUT;
    if truncated {
        let mut end = MAX_OUTPUT;
        while !blob.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        blob.truncate(end);
    }
    let code = if timed_out {
        -1
    } else {
        status.and_then(|state| state.code()).unwrap_or(-1)
    };
    if let Some(handle) = &app {
        let _ = handle.emit(
            "recipe-output",
            serde_json::json!({
                "stream": "exit",
                "text": format!("código de salida {code}"),
                "exitCode": code,
            }),
        );
    }
    Ok(Driven {
        code,
        blob,
        timed_out,
        truncated,
    })
}

fn clip(text: &str) -> String {
    let mut chars = text.chars();
    let clipped: String = chars.by_ref().take(240).collect();
    if chars.next().is_some() {
        format!("{clipped}…")
    } else {
        clipped
    }
}

/// Ejecuta la receta y devuelve el registro clasificado.
///
/// `active` es la carpeta abierta. El cwd es esa carpeta si contiene el
/// ancla; no un padre. Sin carpeta, se prueba la ruta de compilación.
/// `app` emite `recipe-output` en vivo (stdout/stderr + código de salida).
pub fn run(
    recipe: &str,
    active: Option<&Path>,
    app: Option<AppHandle>,
) -> Result<RecipeReport, String> {
    let chosen = spec(recipe)?;
    let cwd = recipe_dir(chosen.ide, active)?;
    let limit = if chosen.ide {
        IDE_RECIPE_LIMIT
    } else {
        CARGO_RECIPE_LIMIT
    };
    let mut command = Command::new(chosen.program);
    command
        .args(chosen.args)
        .current_dir(&cwd)
        .env("CARGO_TERM_COLOR", "never");
    win_cmd::hide_console(&mut command);
    let driven = drive(&mut command, limit, app)?;
    let mut lines = Vec::new();
    let mut true_count = 0u32;
    let mut false_count = 0u32;
    let mut both_count = 0u32;
    let mut neither_count = 0u32;
    let mut truncated = driven.truncated;
    if driven.timed_out {
        false_count = false_count.saturating_add(1);
        lines.push(RecipeLine {
            text: "tiempo agotado".to_string(),
            status: status_key(BelnapValue::False),
            glyph: BelnapValue::False.glyph(),
        });
    }
    for raw in driven.blob.lines() {
        if raw.trim().is_empty() {
            continue;
        }
        if lines.len() == MAX_LINES {
            truncated = true;
            break;
        }
        let (status, glyph) = classify(raw);
        match status {
            "true" => true_count = true_count.saturating_add(1),
            "false" => false_count = false_count.saturating_add(1),
            "both" => both_count = both_count.saturating_add(1),
            _ => neither_count = neither_count.saturating_add(1),
        }
        lines.push(RecipeLine {
            text: clip(raw.trim()),
            status,
            glyph,
        });
    }
    Ok(RecipeReport {
        recipe: recipe.to_string(),
        exit_code: driven.code,
        lines,
        true_count,
        false_count,
        both_count,
        neither_count,
        truncated,
        timed_out: driven.timed_out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_receta_ajena_no_se_ejecuta() {
        assert!(spec("calc").is_err());
        assert!(spec("check && calc").is_err());
        assert!(spec("../cargo").is_err());
        assert!(spec("").is_err());
        let check = spec("check").expect("comprobar");
        assert_eq!(check.program, "cargo");
        assert_eq!(check.args, ["check", "-p", "bara", "--offline"]);
        assert!(!check.ide);
        let typed = spec("typecheck").expect("tipos");
        assert!(typed.ide);
        if cfg!(windows) {
            assert_eq!(typed.program, "cmd.exe");
            assert_eq!(typed.args, ["/d", "/s", "/c", "npm", "run", "typecheck"]);
        } else {
            assert_eq!(typed.program, "npm");
            assert_eq!(typed.args, ["run", "typecheck"]);
        }
    }

    #[test]
    fn la_clasificacion_separa_el_bilatice() {
        assert_eq!(classify("error[E0308]: mismatched types"), ("false", "⊥"));
        assert_eq!(classify("warning: unused variable"), ("both", "⊤∧⊥"));
        assert_eq!(classify("test result: ok. 1 passed"), ("true", "⊤"));
        assert_eq!(classify("   Compiling bara"), ("neither", "∅"));
        assert_eq!(classify("src/error_handler.rs"), ("neither", "∅"));
    }

    #[test]
    fn un_proceso_colgado_se_corta() {
        let mut command = Command::new("ping");
        if cfg!(windows) {
            command.args(["-n", "12", "127.0.0.1"]);
        } else {
            command.args(["-c", "12", "127.0.0.1"]);
        }
        let started = Instant::now();
        let driven = drive(&mut command, Duration::from_millis(350), None).expect("ping");
        assert!(driven.timed_out);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn el_modulo_no_abre_un_shell() {
        let source = include_str!("orchestrate.rs");
        let production = source.split("mod tests").next().unwrap_or(source);
        assert!(!production.contains("sh -c"));
        assert!(!production.contains("read_source"));
        assert!(!production.contains("Command::new(recipe"));
        assert!(!production.contains("Command::new(&"));
        assert!(production.contains("hide_console"));
        let typed = spec("typecheck").expect("tipos");
        assert!(!typed
            .args
            .iter()
            .any(|arg| arg.contains('&') || arg.contains('|')));
    }

    #[test]
    fn el_cwd_no_sube_a_un_ancestro() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("reloj")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("bara-recipe-{nonce}"));
        let child = root.join("crate");
        std::fs::create_dir_all(&child).expect("hijo");
        std::fs::write(root.join("package.json"), "{}\n").expect("package");
        std::fs::write(root.join("Cargo.toml"), "[package]\nname = \"t\"\n").expect("cargo");
        let opened = recipe_dir(true, Some(&root)).expect("raíz npm");
        assert_eq!(opened, std::fs::canonicalize(&root).expect("canon"));
        assert!(recipe_dir(true, Some(&child)).is_err());
        assert!(recipe_dir(false, Some(&child)).is_err());
        let cargo_root = recipe_dir(false, Some(&root)).expect("raíz cargo");
        assert_eq!(cargo_root, std::fs::canonicalize(&root).expect("canon"));
        let _ = std::fs::remove_dir_all(root);
    }
}

//! Recetas de un clic. El catálogo es cerrado: el WebView elige un nombre y
//! el proceso nace con un programa y unos argumentos literales. No hay
//! intérprete de shell ni una cadena de comando armada por el cliente.

#![forbid(unsafe_code)]

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use bara::autopoietic::BelnapValue;
use bara::log_lattice::{observe_log_line, status_key};
use serde::Serialize;

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
        "typecheck" => Ok(Spec {
            program: npm_program(),
            args: &["run", "typecheck"],
            ide: true,
        }),
        _ => Err("la receta no está en el catálogo cerrado".to_string()),
    }
}

/// `npm` en Windows es un `.cmd`. Se nombra el ejecutable; no se abre un shell.
const fn npm_program() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
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

/// Sube desde la carpeta abierta hasta encontrar el ancla. La ruta grabada en
/// el binario (`CARGO_MANIFEST_DIR`) no existe en un MSI instalado en otra máquina.
fn find_anchor(start: &Path, anchor: &str) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    for _ in 0..6 {
        if let Ok(found) = anchored(&current, anchor) {
            return Some(found);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

fn recipe_dir(ide: bool, active: Option<&Path>) -> Result<PathBuf, String> {
    let anchor = if ide { "package.json" } else { "Cargo.toml" };
    if let Some(root) = active {
        if let Some(found) = find_anchor(root, anchor) {
            return Ok(found);
        }
    }
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

/// Lee una tubería hasta la cota y después la vacía para que el hijo no se bloquee.
fn drain_pipe(pipe: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut taken = pipe.take(MAX_OUTPUT as u64);
        let mut buf = Vec::new();
        let _ = taken.read_to_end(&mut buf);
        let mut rest = taken.into_inner();
        let mut sink = [0u8; 4096];
        loop {
            match rest.read(&mut sink) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
        buf
    })
}

/// Espera `limit`. Si el hijo sigue vivo, lo termina y devuelve lo ya leído.
fn drive(command: &mut Command, limit: Duration) -> Result<Driven, String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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
    let out_handle = drain_pipe(stdout);
    let err_handle = drain_pipe(stderr);
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() >= limit => {
                timed_out = true;
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
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
/// `active` es la carpeta abierta en el IDE. Si contiene el ancla (o un padre
/// cercano la contiene), manda ella. Si no, se prueba la ruta de compilación.
pub fn run(recipe: &str, active: Option<&Path>) -> Result<RecipeReport, String> {
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
    let driven = drive(&mut command, limit)?;
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
        assert_eq!(typed.args, ["run", "typecheck"]);
        assert!(typed.ide);
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
        let driven = drive(&mut command, Duration::from_millis(350)).expect("ping");
        assert!(driven.timed_out);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn el_modulo_no_abre_un_shell() {
        let source = include_str!("orchestrate.rs");
        let production = source.split("mod tests").next().unwrap_or(source);
        assert!(!production.contains("cmd /c"));
        assert!(!production.contains("sh -c"));
        assert!(!production.contains("read_source"));
        assert!(!production.contains("Command::new(\"cmd\""));
    }
}

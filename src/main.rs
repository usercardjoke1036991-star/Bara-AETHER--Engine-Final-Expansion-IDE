//! # bara-ide — CLI de análisis del kernel Bara (AETHER‑Ω)
//!
//! Envoltorio de línea de órdenes sobre la biblioteca [`bara_ide`]: lee un
//! documento *Shoresh* (archivo o entrada estándar), lo analiza con el lexer del
//! **kernel congelado** (`bara`, etiqueta `v0.1.0-kernel`) y lo informa en
//! texto. La misma biblioteca alimenta el escritorio Tauri (`src-tauri/`), de
//! modo que CLI e interfaz gráfica comparten motor y tipos.
//!
//! ## Modos
//! * `--tokens` (por defecto) — tabla de tokens con línea y columna.
//! * `--summary` — recuento por clase léxica e inventario de raíces.
//!
//! ## Uso (desde el raíz del workspace contenedor)
//! ```text
//! cargo run -p bara-ide -- bara-ide/samples/genesis.bara    # tabla de tokens
//! cargo run -p bara-ide -- --summary < ruta/al/programa.bara
//! ```

#![forbid(unsafe_code)]

use std::env;
use std::io::{self, Read};
use std::process::ExitCode;

use bara_ide::{analyze, read_source_file, render_report, ReportMode, VERSION};

/// Texto de ayuda de la línea de órdenes.
const USAGE: &str = "\
bara-ide - front-end de IDE para el kernel Bara (AETHER-Omega)

USO:
    bara-ide [OPCIONES] [ARCHIVO]

    Sin ARCHIVO (o con `-`) lee el programa Shoresh de la entrada estandar.

OPCIONES:
    -t, --tokens     Tabla de tokens con linea y columna (modo por defecto).
    -s, --summary    Solo recuento por clase lexica e inventario de raices.
    -h, --help       Muestra esta ayuda.
    -V, --version    Muestra la version del IDE.
";

fn main() -> ExitCode {
    let mut mode = ReportMode::Tokens;
    let mut path: Option<String> = None;

    for arg in env::args().skip(1) {
        match arg.as_str() {
            "-h" | "--help" => {
                print!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            "-V" | "--version" => {
                println!("bara-ide {VERSION} (kernel Bara / AETHER-Omega)");
                return ExitCode::SUCCESS;
            }
            "-t" | "--tokens" => mode = ReportMode::Tokens,
            "-s" | "--summary" => mode = ReportMode::Summary,
            "-" => path = None,
            flag if flag.starts_with('-') => {
                eprintln!("bara-ide: opcion desconocida: {flag}");
                eprint!("{USAGE}");
                return ExitCode::FAILURE;
            }
            file => path = Some(file.to_string()),
        }
    }

    let (source, origin) = match read_source(path.as_deref()) {
        Ok(pair) => pair,
        Err(message) => {
            eprintln!("bara-ide: {message}");
            return ExitCode::FAILURE;
        }
    };

    // El kernel es TOTAL: `analyze` es infalible y jamás entra en pánico.
    let analysis = analyze(&source);
    print!("{}", render_report(&analysis, &origin, mode));

    ExitCode::SUCCESS
}

/// Lee la fuente del archivo indicado, o de la entrada estándar si no hay.
///
/// Devuelve `(texto, origen)`, donde `origen` describe de dónde se leyó para el
/// encabezado del informe. La lectura de archivos delega en la biblioteca (que
/// es también la que usa el escritorio); sólo la entrada estándar es
/// competencia de la CLI.
fn read_source(path: Option<&str>) -> Result<(String, String), String> {
    match path {
        Some(file) => read_source_file(file).map(|text| (text, file.to_string())),
        None => {
            let mut buffer = String::new();
            io::stdin()
                .read_to_string(&mut buffer)
                .map_err(|err| format!("no se pudo leer la entrada estandar: {err}"))?;
            Ok((buffer, "<stdin>".to_string()))
        }
    }
}

//! Script de compilación del backend Tauri del IDE Bara.
//!
//! `tauri_build` hace tres cosas relevantes aquí:
//!
//! 1. Lee y valida `tauri.conf.json`.
//! 2. Genera los esquemas ACL de `capabilities/` y publica las variables
//!    `TAURI_ENV_*` que consumen `tauri::generate_context!()` y los códigos de
//!    front-end.
//! 3. **Embebe el recurso de Windows** (icono, versión, manifiesto) en el
//!    `.exe` mediante un compilador de recursos: `windres` en toolchains
//!    GNU/MinGW, `rc.exe` en MSVC.
//!
//! Sólo el paso 3 depende de herramientas externas. En un toolchain `-gnu` de
//! rustup (que **no** incluye MinGW) `tauri-winres` entra directamente en
//! pánico al no encontrar `windres`, y ese pánico aborta también `cargo
//! check`, que no necesita el recurso para nada. Este script lo evita:
//!
//! * si el usuario ya define `RC`, `RC_<TARGET>` o `RC_<TARGET_CON_GUIONES>`,
//!   se respeta tal cual (`embed-resource` los lee);
//! * si no, se busca `windres`/`llvm-windres`/`x86_64-w64-mingw32-windres` en
//!   el `PATH` y en las raíces habituales de MinGW/MSYS2 y, al encontrarlo, se
//!   publica en `RC`: el icono se embebe con normalidad;
//! * si no existe ninguno, se le pide a `tauri-build` un icono inexistente: la
//!   comprobación falla **antes** de invocar al compilador ausente y ese error
//!   se degrada a un aviso `cargo:warning` visible.
//!
//! Consecuencia: `cargo check` es válido en cualquier entorno; para producir un
//! `.exe` o un instalador completo hay que aportar el compilador de recursos
//! (MSVC — `rustup default stable-x86_64-pc-windows-msvc` — o `windres` de
//! MSYS2/MinGW en el `PATH`).

use std::env;
use std::path::PathBuf;

/// Compiladores *compatibles con `windres`*: `embed-resource` los invoca con
/// los mismos argumentos en toolchains GNU.
const COMPILADORES_WINDRES: [&str; 3] = [
    "windres.exe",
    "llvm-windres.exe",
    "x86_64-w64-mingw32-windres.exe",
];

/// Raíces habituales de instalaciones MinGW/MSYS2.
const RAICES_MINGW: [&str; 4] = [
    r"C:\msys64\mingw64\bin",
    r"C:\msys64\ucrt64\bin",
    r"C:\mingw64\bin",
    r"C:\MinGW\bin",
];

/// ¿El entorno ya indica qué compilador de recursos usar?
fn compilador_indicado_por_entorno() -> bool {
    if env::var_os("RC").is_some() {
        return true;
    }
    match env::var("TARGET") {
        Ok(target) => {
            env::var_os(format!("RC_{target}")).is_some()
                || env::var_os(format!("RC_{}", target.replace('-', "_"))).is_some()
        }
        Err(_) => false,
    }
}

/// Busca un `windres` utilizable: primero en el `PATH`, después en las raíces
/// conocidas de MinGW.
fn buscar_windres() -> Option<PathBuf> {
    let mut directorios: Vec<PathBuf> = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect())
        .unwrap_or_default();
    directorios.extend(RAICES_MINGW.iter().map(PathBuf::from));

    for directorio in directorios {
        for nombre in COMPILADORES_WINDRES {
            let candidato = directorio.join(nombre);
            if candidato.is_file() {
                return Some(candidato);
            }
        }
    }
    None
}

fn main() {
    let objetivo_gnu = env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|entorno| entorno == "gnu");

    if objetivo_gnu && !compilador_indicado_por_entorno() {
        if let Some(windres) = buscar_windres() {
            env::set_var("RC", &windres);
        } else {
            println!(
                "cargo:warning=Bara IDE: no hay windres/llvm-windres/rc.exe disponible; se omite \
                 el recurso de Windows (icono y manifiesto del .exe). `cargo check` es válido, \
                 pero para generar el ejecutable usa MSVC (rustup default \
                 stable-x86_64-pc-windows-msvc) o pon windres de MSYS2/MinGW en el PATH."
            );

            // Icono inexistente => `tauri-build` devuelve Err *antes* de
            // invocar al compilador de recursos ausente (que haría panicar).
            let atributos = tauri_build::Attributes::new().windows_attributes(
                tauri_build::WindowsAttributes::new()
                    .window_icon_path("__sin_compilador_de_recursos__.ico"),
            );
            if let Err(error) = tauri_build::try_build(atributos) {
                println!("cargo:warning=Bara IDE: tauri-build degradado con aviso: {error}");
            }
            return;
        }
    }

    tauri_build::build()
}

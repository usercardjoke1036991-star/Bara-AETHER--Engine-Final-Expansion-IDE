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
//!
//! **Toolchain GNU sin `windres`:** el `.exe` no puede quedarse sin manifiesto
//! ni sin icono. Sin manifiesto no hay contexto de activación Side-by-Side,
//! `comctl32` se resuelve contra el 5.82 de System32 (que no exporta
//! `TaskDialogIndirect`, importado por los menús de tauri) y el arranque muere
//! con 0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND; sin `RT_GROUP_ICON`, `tao` no
//! puede cargar el icono por defecto de la ventana (0x80070715). En ese caso,
//! este script deja un proceso suelto que espera al enlace y embebe ambos
//! recursos con `scripts/win-gnu-recursos.py`; además, `cargo run` y
//! `npm run tauri dev` lo hacen de forma determinista *antes* de lanzar la app
//! mediante el runner declarado en `src-tauri/.cargo/config.toml`.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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

/// Perfil de compilación (`…/target/debug` o `…/target/release`) deducido de
/// `OUT_DIR`, que es `<target>/<perfil>/build/<paquete>-<hash>/out`.
fn directorio_de_perfil() -> Option<PathBuf> {
    let out_dir = PathBuf::from(env::var_os("OUT_DIR")?);
    // `ancestors()` incluye `out_dir`: [out, <paquete>-<hash>, build, <perfil>].
    out_dir.ancestors().nth(3).map(Path::to_path_buf)
}

/// Ruta del `.exe` de la aplicación que está enlazando `cargo`.
fn ruta_del_ejecutable() -> Option<PathBuf> {
    let perfil = directorio_de_perfil()?;
    let paquete = env::var("CARGO_PKG_NAME").ok()?;
    Some(perfil.join(format!("{paquete}.exe")))
}

/// Deja un proceso suelto que embebe manifiesto e icono en cuanto el enlazador
/// escriba el `.exe` (ver `scripts/win-gnu-recursos.py`).
///
/// En Windows se desacopla del job de Cargo con `CreateProcess` (sin `cmd`).
/// `cargo check` no enlaza, así que ese proceso se limita a agotar su espera
/// sin tocar nada.
fn lanzar_parcheador(exe: &Path) {
    let guion = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
        .join("scripts")
        .join("win-gnu-recursos.py");
    if !guion.is_file() {
        return;
    }
    let mut command = Command::new("python");
    command
        .arg(&guion)
        .arg("--exe")
        .arg(exe)
        .arg("--wait")
        .arg("900")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
        command.creation_flags(
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB,
        );
    }
    let _ = command.spawn();
}

fn main() {
    let objetivo_gnu = env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|entorno| entorno == "gnu");

    // El `ld` de MinGW exporta *automáticamente* todos los símbolos de una
    // `cdylib`, y la plantilla de Tauri v2 declara ese `crate-type` (para
    // móvil) junto a `staticlib` y `rlib`. Con el árbol de dependencias
    // completo (tauri, wry, windows-rs…) son ~95.000 exportaciones y el
    // enlazador desborda el límite de ordinales de PE:
    //
    //     ld: error: export ordinal too large: 95834
    //
    // El IDE de escritorio no exporta nada de esa biblioteca (el `.exe`
    // enlaza la `rlib`), así que se desactiva la exportación automática.
    // Sólo afecta a toolchains GNU: MSVC no necesita nada de esto.
    if objetivo_gnu {
        println!("cargo:rustc-link-arg=-Wl,--exclude-all-symbols");
    }

    if objetivo_gnu && !compilador_indicado_por_entorno() {
        if let Some(windres) = buscar_windres() {
            env::set_var("RC", &windres);
        } else {
            // Icono inexistente => `tauri-build` devuelve Err *antes* de
            // invocar al compilador de recursos ausente (que haría panicar).
            let atributos = tauri_build::Attributes::new().windows_attributes(
                tauri_build::WindowsAttributes::new()
                    .window_icon_path("__sin_compilador_de_recursos__.ico"),
            );
            if let Err(error) = tauri_build::try_build(atributos) {
                println!("cargo:warning=Bara IDE: tauri-build degradado con aviso: {error}");
            }

            // Los recursos que faltan (manifiesto y icono) se embeben con
            // `scripts/win-gnu-recursos.py`: aquí queda un proceso suelto que
            // espera al enlace, y `cargo run`/`npm run tauri dev` lo hacen de
            // forma determinista con el runner de `.cargo/config.toml`.
            println!(
                "cargo:warning=Bara IDE: no hay windres/llvm-windres/rc.exe disponible; el \
                 manifiesto (Common-Controls 6.0, imprescindible para TaskDialogIndirect) y el \
                 icono se embeben con scripts/win-gnu-recursos.py tras el enlace. `cargo check` \
                 es válido; para MSVC no hace falta nada de esto."
            );
            if let Some(exe) = ruta_del_ejecutable() {
                lanzar_parcheador(&exe);
            }
            return;
        }
    }

    tauri_build::build()
}

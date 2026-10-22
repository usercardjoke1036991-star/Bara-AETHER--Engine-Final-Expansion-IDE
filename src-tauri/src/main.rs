//! Punto de entrada del escritorio: sólo arranca el backend ([`run`]).
//!
//! En compilaciones optimizadas no se abre consola (la aplicación es una
//! ventana WebView2); en depuración se conserva para ver los mensajes de error.
//!
//! [`run`]: bara_ide_desktop_lib::run

#![forbid(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bara_ide_desktop_lib::run()
}

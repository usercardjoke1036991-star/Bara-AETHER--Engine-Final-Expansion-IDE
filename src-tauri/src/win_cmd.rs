//! Flags de proceso en Windows: sin consola negra.
//!
//! `CreateProcess` abre una consola si el hijo es un PE de consola (cargo,
//! git, npm vía cmd). Con `CREATE_NO_WINDOW` el hijo hereda los pipes y no
//! aparece una ventana negra.

#![forbid(unsafe_code)]

use std::process::Command;

/// Aplica `CREATE_NO_WINDOW` en Windows. En el resto de plataformas no hace nada.
pub fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = command;
}

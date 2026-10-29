//! Hilo de reposo del escritorio. Duerme entre pasadas y pide la propuesta al
//! proceso del kernel. No escribe: la escritura la confirma el cockpit.

#![forbid(unsafe_code)]

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use bara_kernel_host::KernelHost;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use bara_kernel_host::workspace::ActiveWorkspace;

/// Un aviso como máximo, ya serializado como lo pinta el cockpit.
#[derive(Debug, Default)]
pub struct IdleBridge {
    notice: Option<Value>,
}

impl IdleBridge {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn current(&self) -> Option<Value> {
        self.notice.clone()
    }

    pub fn clear(&mut self) {
        self.notice = None;
    }

    fn store(&mut self, notice: Value) {
        if self.notice.is_none() {
            self.notice = Some(notice);
        }
    }
}

/// Arranca un solo hilo. Cada pasada espera cinco segundos antes de leer.
pub fn start(handle: AppHandle) {
    let _ = thread::Builder::new()
        .name("bara-idle".to_string())
        .spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            scan_once(&handle);
        });
}

fn scan_once(handle: &AppHandle) {
    let workspace = handle.state::<ActiveWorkspace>();
    let Ok(root) = workspace.get() else {
        return;
    };
    let kernel = handle.state::<KernelHost>();
    let slot = handle.state::<Mutex<IdleBridge>>();
    let pending = match slot.lock() {
        Ok(guard) => guard.current().is_some(),
        Err(_) => false,
    };
    let notice = kernel.call("idle_seek", json!({ "root": root })).ok();
    let Some(notice) = notice else {
        return;
    };
    if pending {
        if notice.is_null() {
            if let Ok(mut guard) = slot.lock() {
                guard.clear();
            }
        }
        return;
    }
    if notice.is_null() {
        return;
    }
    if let Ok(mut guard) = slot.lock() {
        guard.store(notice);
    };
}

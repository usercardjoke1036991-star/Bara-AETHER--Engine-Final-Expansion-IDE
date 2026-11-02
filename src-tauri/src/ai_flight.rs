//! Cancelación de `ai_exchange` en vuelo (B8: Detener).
//!
//! Además de la bandera, guarda clones del socket para cerrarlo: Detener
//! corta el TCP, no sólo la promesa del WebView.

use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

struct FlightInner {
    cancel: AtomicBool,
    sockets: Mutex<Vec<TcpStream>>,
}

/// Handle clonable que viaja al hilo de `ureq`/HTTP.
#[derive(Clone)]
pub struct FlightHandle {
    inner: Arc<FlightInner>,
}

impl FlightHandle {
    pub fn begin(&self) {
        self.inner.cancel.store(false, Ordering::SeqCst);
        if let Ok(mut sockets) = self.inner.sockets.lock() {
            sockets.clear();
        }
    }

    pub fn request_cancel(&self) {
        self.inner.cancel.store(true, Ordering::SeqCst);
        self.shutdown_sockets();
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.cancel.load(Ordering::SeqCst)
    }

    /// Clon del socket vivo. `request_cancel` hace `shutdown` y desbloquea el read.
    pub fn track_socket(&self, stream: &TcpStream) {
        if let Ok(clone) = stream.try_clone() {
            if let Ok(mut sockets) = self.inner.sockets.lock() {
                sockets.push(clone);
            }
        }
    }

    fn shutdown_sockets(&self) {
        if let Ok(mut sockets) = self.inner.sockets.lock() {
            for sock in sockets.drain(..) {
                let _ = sock.shutdown(Shutdown::Both);
            }
        }
    }
}

/// Estado Tauri: un solo vuelo de chat a la vez.
pub struct AiFlight {
    handle: FlightHandle,
}

impl AiFlight {
    pub fn new() -> Self {
        Self {
            handle: FlightHandle {
                inner: Arc::new(FlightInner {
                    cancel: AtomicBool::new(false),
                    sockets: Mutex::new(Vec::new()),
                }),
            },
        }
    }

    pub fn handle(&self) -> FlightHandle {
        self.handle.clone()
    }

    pub fn begin(&self) {
        self.handle.begin();
    }

    pub fn request_cancel(&self) {
        self.handle.request_cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.handle.is_cancelled()
    }
}

#[cfg(test)]
mod tests {
    use super::AiFlight;

    #[test]
    fn begin_limpia_y_cancel_marca() {
        let flight = AiFlight::new();
        flight.request_cancel();
        assert!(flight.is_cancelled());
        flight.begin();
        assert!(!flight.is_cancelled());
        flight.request_cancel();
        assert!(flight.is_cancelled());
    }
}

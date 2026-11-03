//! Cancelación de `ai_exchange` en vuelo (B8: Detener).
//!
//! Además de la bandera, guarda clones del socket para cerrarlo: Detener
//! corta el TCP, no sólo la promesa del WebView.

use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

struct FlightInner {
    cancel: AtomicBool,
    /// Hay un `ai_exchange` dentro de `enter`. `arm_turn` no limpia ese vuelo.
    in_flight: AtomicBool,
    sockets: Mutex<Vec<TcpStream>>,
}

/// Handle clonable que viaja al hilo del HTTP propio (`ai_http`).
#[derive(Clone)]
pub struct FlightHandle {
    inner: Arc<FlightInner>,
}

impl FlightHandle {
    /// Prepara el socket del vuelo. Si Detener ya marcó, no borra la bandera.
    pub fn begin(&self) {
        self.inner.in_flight.store(true, Ordering::SeqCst);
        if self.is_cancelled() {
            return;
        }
        if let Ok(mut sockets) = self.inner.sockets.lock() {
            sockets.clear();
        }
    }

    pub fn finish(&self) {
        self.inner.in_flight.store(false, Ordering::SeqCst);
    }

    /// Nuevo turno del usuario. No corre dentro de `begin`: un cancel en curso se queda.
    pub fn arm_turn(&self) {
        if self.inner.in_flight.load(Ordering::SeqCst) {
            return;
        }
        self.inner.cancel.store(false, Ordering::SeqCst);
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
                    in_flight: AtomicBool::new(false),
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

    pub fn arm_turn(&self) {
        self.handle.arm_turn();
    }

    /// Marca el vuelo y lo suelta al salir, aunque el comando devuelva antes.
    pub fn enter(&self) -> FlightGuard {
        self.begin();
        FlightGuard {
            handle: self.handle.clone(),
        }
    }
}

/// Suelta `in_flight` al terminar `ai_exchange`.
pub struct FlightGuard {
    handle: FlightHandle,
}

impl Drop for FlightGuard {
    fn drop(&mut self) {
        self.handle.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::AiFlight;

    #[test]
    fn begin_no_limpia_un_cancel_pedido() {
        let flight = AiFlight::new();
        flight.request_cancel();
        assert!(flight.is_cancelled());
        flight.begin();
        assert!(
            flight.is_cancelled(),
            "begin no borra un Detener que ya ganó la carrera"
        );
        flight.arm_turn();
        assert!(
            flight.is_cancelled(),
            "arm no limpia mientras el exchange sigue en vuelo"
        );
        flight.handle().finish();
        flight.arm_turn();
        assert!(!flight.is_cancelled());
    }
}

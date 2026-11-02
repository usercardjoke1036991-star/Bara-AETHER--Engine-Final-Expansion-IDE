//! Cancelación cooperativa de `ai_exchange` en vuelo (B8: Detener).

use std::sync::atomic::{AtomicBool, Ordering};

/// Bandera compartida: Detener marca cancelado; `ai_exchange` deja de esperar.
#[derive(Default)]
pub struct AiFlight {
    cancel: AtomicBool,
}

impl AiFlight {
    pub fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
        }
    }

    pub fn begin(&self) {
        self.cancel.store(false, Ordering::SeqCst);
    }

    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
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

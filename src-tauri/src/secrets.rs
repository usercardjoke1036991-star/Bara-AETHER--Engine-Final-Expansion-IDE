//! Llavero de las claves de API.
//!
//! El WebView guarda, pregunta si existe y borra. Nunca recibe el secreto.
//! Windows usa Credential Manager, macOS el Keychain y Linux Secret Service.
//!
//! Slots **separados** por proveedor:
//! - `com.aetheromega.bara.ide.openai`
//! - `com.aetheromega.bara.ide.deepseek`
//! - `com.aetheromega.bara.ide.anthropic`
//!
//! Migración (sin perder clave):
//! 1. Target legacy `openai.com.aetheromega.bara.ide` → slot `openai`.
//! 2. Slot compartido histórico `…ide.deepseek` (openai|deepseek juntos) →
//!    se copia al slot del proveedor pedido la primera vez; el compartido
//!    se borra sólo cuando **ambos** openai y deepseek ya tienen entrada
//!    propia o tras migrar al acceder.

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

/// Servicio histórico (target `openai.com.aetheromega.bara.ide`).
const LEGACY_SERVICE: &str = "com.aetheromega.bara.ide";

/// Cuenta del Entry nuevo (queda a la izquierda del punto en el target).
const NEW_USER: &str = "com.aetheromega.bara.ide";

/// Migración legacy→nuevo: una vez por proceso y proveedor.
static MIGRATED_OPENAI: AtomicBool = AtomicBool::new(false);
static MIGRATED_DEEPSEEK: AtomicBool = AtomicBool::new(false);
static MIGRATED_ANTHROPIC: AtomicBool = AtomicBool::new(false);

/// Copia de la sesión. No se persiste y no se serializa.
#[derive(Default)]
pub struct Session {
    keys: HashMap<String, String>,
}

/// Almacén persistente. Los tests usan uno en memoria.
pub trait OsSecrets {
    fn set(&self, service: &str, user: &str, secret: &str) -> Result<(), String>;
    fn get(&self, service: &str, user: &str) -> Result<Option<String>, String>;
    fn delete(&self, service: &str, user: &str) -> Result<(), String>;
}

/// Llavero del sistema operativo. En Android no hay Keystore en este binario.
pub struct System;

impl OsSecrets for System {
    fn set(&self, service: &str, user: &str, secret: &str) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            let _ = (service, user, secret);
            return Err("este binario no incluye el Keystore de Android".to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            keyring::Entry::new(service, user)
                .map_err(limpiar)?
                .set_password(secret)
                .map_err(limpiar)
        }
    }

    fn get(&self, service: &str, user: &str) -> Result<Option<String>, String> {
        #[cfg(target_os = "android")]
        {
            let _ = (service, user);
            return Err("este binario no incluye el Keystore de Android".to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            match keyring::Entry::new(service, user)
                .map_err(limpiar)?
                .get_password()
            {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(limpiar(error)),
            }
        }
    }

    fn delete(&self, service: &str, user: &str) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            let _ = (service, user);
            return Ok(());
        }
        #[cfg(not(target_os = "android"))]
        {
            match keyring::Entry::new(service, user)
                .map_err(limpiar)?
                .delete_credential()
            {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(limpiar(error)),
            }
        }
    }
}

fn limpiar(error: impl ToString) -> String {
    let text = error.to_string();
    if text.to_ascii_lowercase().contains("password") {
        return "el llavero del sistema rechazó la operación".to_string();
    }
    "el llavero del sistema no está disponible".to_string()
}

/// Proveedor lógico del front → (service, user) del Entry nuevo.
fn slot(provider: &str) -> Result<(&'static str, &'static str), String> {
    match provider.trim() {
        "openai" => Ok(("openai", NEW_USER)),
        "deepseek" => Ok(("deepseek", NEW_USER)),
        "anthropic" => Ok(("anthropic", NEW_USER)),
        _ => Err("el proveedor no tiene llavero".to_string()),
    }
}

fn session_key(provider: &str) -> Result<&'static str, String> {
    match provider.trim() {
        "openai" => Ok("openai"),
        "deepseek" => Ok("deepseek"),
        "anthropic" => Ok("anthropic"),
        _ => Err("el proveedor no tiene llavero".to_string()),
    }
}

fn migrated_flag(provider: &str) -> Option<&'static AtomicBool> {
    match provider.trim() {
        "openai" => Some(&MIGRATED_OPENAI),
        "deepseek" => Some(&MIGRATED_DEEPSEEK),
        "anthropic" => Some(&MIGRATED_ANTHROPIC),
        _ => None,
    }
}

/// Lee legacy / slot compartido histórico y materializa el slot propio.
fn migrate_legacy_once<O: OsSecrets>(os: &O, provider: &str) -> Result<(), String> {
    let Some(flag) = migrated_flag(provider) else {
        return Ok(());
    };
    if flag.load(Ordering::SeqCst) {
        return Ok(());
    }
    let (new_service, new_user) = slot(provider)?;
    if os.get(new_service, new_user)?.is_some() {
        flag.store(true, Ordering::SeqCst);
        return Ok(());
    }

    // 1) Legacy openai.com.aetheromega.bara.ide (sólo openai / anthropic).
    if provider == "openai" {
        if let Some(secret) = os.get(LEGACY_SERVICE, "openai")? {
            if !secret.trim().is_empty() {
                os.set(new_service, new_user, secret.trim())?;
                let _ = os.delete(LEGACY_SERVICE, "openai");
                flag.store(true, Ordering::SeqCst);
                return Ok(());
            }
            let _ = os.delete(LEGACY_SERVICE, "openai");
        }
    }
    if provider == "anthropic" {
        if let Some(secret) = os.get(LEGACY_SERVICE, "anthropic")? {
            if !secret.trim().is_empty() {
                os.set(new_service, new_user, secret.trim())?;
                let _ = os.delete(LEGACY_SERVICE, "anthropic");
                flag.store(true, Ordering::SeqCst);
                return Ok(());
            }
            let _ = os.delete(LEGACY_SERVICE, "anthropic");
        }
    }

    // 2) Slot compartido histórico `deepseek` (openai|deepseek pisaban la misma clave).
    if provider == "openai" || provider == "deepseek" {
        if let Some(secret) = os.get("deepseek", NEW_USER)? {
            if !secret.trim().is_empty() {
                // Si el slot pedido es deepseek, ya está; si es openai, copia
                // sin borrar aún el compartido (deepseek sigue leyéndolo).
                if provider == "openai" {
                    os.set("openai", NEW_USER, secret.trim())?;
                }
                flag.store(true, Ordering::SeqCst);
                return Ok(());
            }
        }
    }

    flag.store(true, Ordering::SeqCst);
    Ok(())
}

/// Guarda la clave. `remember` la deja en el sistema; si no, sólo en esta sesión.
pub fn save<O: OsSecrets>(
    session: &mut Session,
    os: &O,
    provider: &str,
    secret: &str,
    remember: bool,
) -> Result<(), String> {
    let key = session_key(provider)?;
    let secret = secret.trim();
    if secret.is_empty() {
        return Err("la clave está vacía".to_string());
    }
    if remember {
        let (service, user) = slot(provider)?;
        os.set(service, user, secret)?;
        if provider == "openai" {
            let _ = os.delete(LEGACY_SERVICE, "openai");
        }
        if provider == "anthropic" {
            let _ = os.delete(LEGACY_SERVICE, "anthropic");
        }
        session.keys.remove(key);
        return Ok(());
    }
    let (service, user) = slot(provider)?;
    let _ = os.delete(service, user);
    if provider == "openai" {
        let _ = os.delete(LEGACY_SERVICE, "openai");
    }
    if provider == "anthropic" {
        let _ = os.delete(LEGACY_SERVICE, "anthropic");
    }
    session.keys.insert(key.to_string(), secret.to_string());
    Ok(())
}

/// `true` si hay clave en la sesión o en el sistema. No devuelve el secreto.
pub fn exists<O: OsSecrets>(session: &Session, os: &O, provider: &str) -> Result<bool, String> {
    let key = session_key(provider)?;
    if session.keys.contains_key(key) {
        return Ok(true);
    }
    let _ = migrate_legacy_once(os, provider);
    let (service, user) = slot(provider)?;
    Ok(os.get(service, user)?.is_some())
}

/// Secreto para la llamada saliente. No sale del proceso.
pub fn lookup<O: OsSecrets>(session: &Session, os: &O, provider: &str) -> Result<String, String> {
    let key = session_key(provider)?;
    if let Some(secret) = session.keys.get(key) {
        return Ok(secret.clone());
    }
    let _ = migrate_legacy_once(os, provider);
    let (service, user) = slot(provider)?;
    os.get(service, user)?
        .filter(|secret| !secret.is_empty())
        .ok_or_else(|| "no hay clave para este proveedor".to_string())
}

/// Borra la sesión y el sistema (targets nuevo y viejo).
pub fn delete<O: OsSecrets>(session: &mut Session, os: &O, provider: &str) -> Result<(), String> {
    let key = session_key(provider)?;
    session.keys.remove(key);
    let (service, user) = slot(provider)?;
    os.delete(service, user)?;
    if provider == "openai" {
        let _ = os.delete(LEGACY_SERVICE, "openai");
    }
    if provider == "anthropic" {
        let _ = os.delete(LEGACY_SERVICE, "anthropic");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MemoryOs {
        map: Mutex<HashMap<(String, String), String>>,
    }

    impl MemoryOs {
        fn new() -> Self {
            Self {
                map: Mutex::new(HashMap::new()),
            }
        }
    }

    impl OsSecrets for MemoryOs {
        fn set(&self, service: &str, user: &str, secret: &str) -> Result<(), String> {
            self.map
                .lock()
                .expect("os")
                .insert((service.to_string(), user.to_string()), secret.to_string());
            Ok(())
        }

        fn get(&self, service: &str, user: &str) -> Result<Option<String>, String> {
            Ok(self
                .map
                .lock()
                .expect("os")
                .get(&(service.to_string(), user.to_string()))
                .cloned())
        }

        fn delete(&self, service: &str, user: &str) -> Result<(), String> {
            self.map
                .lock()
                .expect("os")
                .remove(&(service.to_string(), user.to_string()));
            Ok(())
        }
    }

    #[test]
    fn guardar_existe_y_borrar() {
        MIGRATED_ANTHROPIC.store(false, Ordering::SeqCst);
        let os = MemoryOs::new();
        let mut session = Session::default();
        save(&mut session, &os, "anthropic", "clave-de-prueba", false).expect("guardar");
        assert!(exists(&session, &os, "anthropic").expect("existe"));
        assert_eq!(
            lookup(&session, &os, "anthropic").expect("leer"),
            "clave-de-prueba"
        );
        delete(&mut session, &os, "anthropic").expect("borrar");
        assert!(!exists(&session, &os, "anthropic").expect("ya no"));
        assert!(lookup(&session, &os, "anthropic").is_err());
    }

    #[test]
    fn openai_y_deepseek_no_se_pisan() {
        MIGRATED_OPENAI.store(false, Ordering::SeqCst);
        MIGRATED_DEEPSEEK.store(false, Ordering::SeqCst);
        let os = MemoryOs::new();
        let mut session = Session::default();
        save(&mut session, &os, "openai", "sk-openai", true).expect("openai");
        save(&mut session, &os, "deepseek", "sk-deepseek", true).expect("deepseek");
        assert_eq!(lookup(&session, &os, "openai").expect("o"), "sk-openai");
        assert_eq!(lookup(&session, &os, "deepseek").expect("d"), "sk-deepseek");
        assert_eq!(
            os.get("openai", NEW_USER).expect("os").as_deref(),
            Some("sk-openai")
        );
        assert_eq!(
            os.get("deepseek", NEW_USER).expect("os").as_deref(),
            Some("sk-deepseek")
        );
    }

    #[test]
    fn migra_compartido_historico_a_openai_sin_perder_deepseek() {
        MIGRATED_OPENAI.store(false, Ordering::SeqCst);
        MIGRATED_DEEPSEEK.store(false, Ordering::SeqCst);
        let os = MemoryOs::new();
        let session = Session::default();
        os.set("deepseek", NEW_USER, "sk-compartida")
            .expect("shared");
        assert_eq!(
            lookup(&session, &os, "openai").expect("migrar openai"),
            "sk-compartida"
        );
        assert_eq!(
            lookup(&session, &os, "deepseek").expect("deepseek intacto"),
            "sk-compartida"
        );
        assert_eq!(
            os.get("openai", NEW_USER).expect("os").as_deref(),
            Some("sk-compartida")
        );
    }

    #[test]
    fn migra_el_target_legacy_openai_punto_servicio() {
        MIGRATED_OPENAI.store(false, Ordering::SeqCst);
        let os = MemoryOs::new();
        let session = Session::default();
        os.set(LEGACY_SERVICE, "openai", "secreto-legacy")
            .expect("legacy");
        assert_eq!(
            lookup(&session, &os, "openai").expect("migrar+leer"),
            "secreto-legacy"
        );
        assert!(os.get(LEGACY_SERVICE, "openai").expect("viejo").is_none());
        assert_eq!(
            os.get("openai", NEW_USER).expect("nuevo").as_deref(),
            Some("secreto-legacy")
        );
    }

    #[test]
    fn recordar_quita_la_copia_del_sistema_si_la_sesion_manda() {
        MIGRATED_ANTHROPIC.store(false, Ordering::SeqCst);
        let os = MemoryOs::new();
        let mut session = Session::default();
        save(&mut session, &os, "anthropic", "persistida", true).expect("sistema");
        save(&mut session, &os, "anthropic", "efímera", false).expect("sesión");
        assert!(os.get("anthropic", NEW_USER).expect("os").is_none());
        assert_eq!(lookup(&session, &os, "anthropic").expect("leer"), "efímera");
    }

    #[test]
    fn un_proveedor_ajeno_no_entra() {
        let os = MemoryOs::new();
        let mut session = Session::default();
        assert!(save(&mut session, &os, "otro", "x", true).is_err());
        assert!(exists(&session, &os, "otro").is_err());
    }

    #[test]
    fn el_prefijo_del_servicio_es_el_esperado() {
        let (service, user) = slot("openai").expect("slot");
        assert_eq!(service, "openai");
        assert_eq!(user, "com.aetheromega.bara.ide");
        let (ds, _) = slot("deepseek").expect("ds");
        assert_eq!(ds, "deepseek");
        assert_eq!(LEGACY_SERVICE, "com.aetheromega.bara.ide");
    }
}

//! Llavero de las claves de API.
//!
//! El WebView guarda, pregunta si existe y borra. Nunca recibe el secreto.
//! Windows usa Credential Manager, macOS el Keychain y Linux Secret Service.
//! Este binario de escritorio no escribe el secreto en un archivo. Android
//! queda para el Keystore del APK: aquí no hay un sustituto en disco.
//!
//! En Windows el target visible suele ser `{user}.{service}`. El target nuevo
//! es `com.aetheromega.bara.ide.deepseek` (y `.anthropic`). La migración lee
//! el viejo `openai.com.aetheromega.bara.ide`, escribe el nuevo, verifica y
//! borra el viejo sin pasar la clave por el frontend ni por los logs.

#![forbid(unsafe_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

/// Servicio histórico (target `openai.com.aetheromega.bara.ide`).
const LEGACY_SERVICE: &str = "com.aetheromega.bara.ide";

/// Cuenta del Entry nuevo (queda a la izquierda del punto en el target).
const NEW_USER: &str = "com.aetheromega.bara.ide";

/// Migración legacy→nuevo: una vez por proceso.
static MIGRATED: AtomicBool = AtomicBool::new(false);

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
///
/// Target Windows esperado: `{user}.{service}` =
/// `com.aetheromega.bara.ide.deepseek` / `.anthropic`.
fn slot(provider: &str) -> Result<(&'static str, &'static str), String> {
    match provider.trim() {
        "openai" | "deepseek" => Ok(("deepseek", NEW_USER)),
        "anthropic" => Ok(("anthropic", NEW_USER)),
        _ => Err("el proveedor no tiene llavero".to_string()),
    }
}

fn legacy_account(provider: &str) -> Option<&'static str> {
    match provider.trim() {
        "openai" | "deepseek" => Some("openai"),
        "anthropic" => Some("anthropic"),
        _ => None,
    }
}

fn session_key(provider: &str) -> Result<&'static str, String> {
    match provider.trim() {
        "openai" | "deepseek" => Ok("deepseek"),
        "anthropic" => Ok("anthropic"),
        _ => Err("el proveedor no tiene llavero".to_string()),
    }
}

/// Lee el target viejo, escribe el nuevo, verifica y borra el viejo.
fn migrate_legacy_once<O: OsSecrets>(os: &O, provider: &str) -> Result<(), String> {
    if MIGRATED.load(Ordering::SeqCst) {
        return Ok(());
    }
    let Some(old_account) = legacy_account(provider) else {
        return Ok(());
    };
    let (new_service, new_user) = slot(provider)?;
    // ¿Ya hay clave en el target nuevo?
    if os.get(new_service, new_user)?.is_some() {
        let _ = os.delete(LEGACY_SERVICE, old_account);
        MIGRATED.store(true, Ordering::SeqCst);
        return Ok(());
    }
    let Some(secret) = os.get(LEGACY_SERVICE, old_account)? else {
        MIGRATED.store(true, Ordering::SeqCst);
        return Ok(());
    };
    if secret.trim().is_empty() {
        let _ = os.delete(LEGACY_SERVICE, old_account);
        MIGRATED.store(true, Ordering::SeqCst);
        return Ok(());
    }
    os.set(new_service, new_user, secret.trim())?;
    let verified = os
        .get(new_service, new_user)?
        .filter(|value| value == secret.trim());
    if verified.is_none() {
        return Err("la migración del llavero no verificó la clave nueva".to_string());
    }
    os.delete(LEGACY_SERVICE, old_account)?;
    MIGRATED.store(true, Ordering::SeqCst);
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
        // Limpia el target viejo si aún existiera.
        if let Some(old) = legacy_account(provider) {
            let _ = os.delete(LEGACY_SERVICE, old);
        }
        session.keys.remove(key);
        return Ok(());
    }
    let (service, user) = slot(provider)?;
    let _ = os.delete(service, user);
    if let Some(old) = legacy_account(provider) {
        let _ = os.delete(LEGACY_SERVICE, old);
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
    if let Some(old) = legacy_account(provider) {
        let _ = os.delete(LEGACY_SERVICE, old);
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
            self.map.lock().expect("os").insert(
                (service.to_string(), user.to_string()),
                secret.to_string(),
            );
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
        MIGRATED.store(false, Ordering::SeqCst);
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
    fn la_migracion_pasa_al_sistema_y_borra_la_sesion() {
        MIGRATED.store(false, Ordering::SeqCst);
        let os = MemoryOs::new();
        let mut session = Session::default();
        save(&mut session, &os, "openai", "vieja", false).expect("sesión");
        save(&mut session, &os, "openai", "nueva", true).expect("migrar");
        assert!(session.keys.is_empty());
        assert_eq!(
            os.get("deepseek", NEW_USER).expect("os").as_deref(),
            Some("nueva")
        );
        assert!(exists(&session, &os, "openai").expect("sigue"));
        assert_eq!(lookup(&session, &os, "openai").expect("leer"), "nueva");
    }

    #[test]
    fn migra_el_target_legacy_openai_punto_servicio() {
        MIGRATED.store(false, Ordering::SeqCst);
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
            os.get("deepseek", NEW_USER).expect("nuevo").as_deref(),
            Some("secreto-legacy")
        );
    }

    #[test]
    fn recordar_quita_la_copia_del_sistema_si_la_sesion_manda() {
        MIGRATED.store(false, Ordering::SeqCst);
        let os = MemoryOs::new();
        let mut session = Session::default();
        save(&mut session, &os, "anthropic", "persistida", true).expect("sistema");
        save(&mut session, &os, "anthropic", "efímera", false).expect("sesión");
        assert!(os.get("anthropic", NEW_USER).expect("os").is_none());
        assert_eq!(lookup(&session, &os, "anthropic").expect("leer"), "efímera");
    }

    #[test]
    fn un_proveedor_ajeno_no_entra() {
        MIGRATED.store(false, Ordering::SeqCst);
        let os = MemoryOs::new();
        let mut session = Session::default();
        assert!(save(&mut session, &os, "otro", "x", true).is_err());
        assert!(exists(&session, &os, "otro").is_err());
    }

    #[test]
    fn el_prefijo_del_servicio_es_el_esperado() {
        let (service, user) = slot("openai").expect("slot");
        assert_eq!(service, "deepseek");
        assert_eq!(user, "com.aetheromega.bara.ide");
        assert_eq!(LEGACY_SERVICE, "com.aetheromega.bara.ide");
    }
}

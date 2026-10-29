//! Llavero de las claves de API.
//!
//! El WebView guarda, pregunta si existe y borra. Nunca recibe el secreto.
//! Windows usa Credential Manager, macOS el Keychain y Linux Secret Service.
//! Este binario de escritorio no escribe el secreto en un archivo. Android
//! queda para el Keystore del APK: aquí no hay un sustituto en disco.

#![forbid(unsafe_code)]

use std::collections::HashMap;

/// Servicio del llavero del sistema. No es una ruta.
const SERVICE: &str = "com.aetheromega.bara.ide";

/// Copia de la sesión. No se persiste y no se serializa.
#[derive(Default)]
pub struct Session {
    keys: HashMap<String, String>,
}

/// Almacén persistente. Los tests usan uno en memoria.
pub trait OsSecrets {
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// Llavero del sistema operativo. En Android no hay Keystore en este binario.
pub struct System;

impl OsSecrets for System {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            let _ = (account, secret);
            return Err("este binario no incluye el Keystore de Android".to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            keyring::Entry::new(SERVICE, account)
                .map_err(limpiar)?
                .set_password(secret)
                .map_err(limpiar)
        }
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        #[cfg(target_os = "android")]
        {
            let _ = account;
            return Err("este binario no incluye el Keystore de Android".to_string());
        }
        #[cfg(not(target_os = "android"))]
        {
            match keyring::Entry::new(SERVICE, account)
                .map_err(limpiar)?
                .get_password()
            {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(limpiar(error)),
            }
        }
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            let _ = account;
            return Ok(());
        }
        #[cfg(not(target_os = "android"))]
        {
            match keyring::Entry::new(SERVICE, account)
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

fn cuenta(provider: &str) -> Result<&str, String> {
    match provider.trim() {
        "anthropic" | "openai" => Ok(provider.trim()),
        _ => Err("el proveedor no tiene llavero".to_string()),
    }
}

/// Guarda la clave. `remember` la deja en el sistema; si no, sólo en esta sesión.
pub fn save<O: OsSecrets>(
    session: &mut Session,
    os: &O,
    provider: &str,
    secret: &str,
    remember: bool,
) -> Result<(), String> {
    if remember {
        return migrate(session, os, provider, secret);
    }
    let account = cuenta(provider)?;
    let secret = secret.trim();
    if secret.is_empty() {
        return Err("la clave está vacía".to_string());
    }
    os.delete(account)?;
    session.keys.insert(account.to_string(), secret.to_string());
    Ok(())
}

/// La migración es un guardado persistente: sale de la sesión y entra al sistema.
pub fn migrate<O: OsSecrets>(
    session: &mut Session,
    os: &O,
    provider: &str,
    secret: &str,
) -> Result<(), String> {
    let account = cuenta(provider)?;
    let secret = secret.trim();
    if secret.is_empty() {
        return Err("la clave está vacía".to_string());
    }
    os.set(account, secret)?;
    session.keys.remove(account);
    Ok(())
}

/// `true` si hay clave en la sesión o en el sistema. No devuelve el secreto.
pub fn exists<O: OsSecrets>(session: &Session, os: &O, provider: &str) -> Result<bool, String> {
    let account = cuenta(provider)?;
    if session.keys.contains_key(account) {
        return Ok(true);
    }
    Ok(os.get(account)?.is_some())
}

/// Secreto para la llamada saliente. No sale del proceso.
pub fn lookup<O: OsSecrets>(session: &Session, os: &O, provider: &str) -> Result<String, String> {
    let account = cuenta(provider)?;
    if let Some(secret) = session.keys.get(account) {
        return Ok(secret.clone());
    }
    os.get(account)?
        .filter(|secret| !secret.is_empty())
        .ok_or_else(|| "no hay clave para este proveedor".to_string())
}

/// Borra la sesión y el sistema.
pub fn delete<O: OsSecrets>(session: &mut Session, os: &O, provider: &str) -> Result<(), String> {
    let account = cuenta(provider)?;
    session.keys.remove(account);
    os.delete(account)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MemoryOs {
        map: Mutex<HashMap<String, String>>,
    }

    impl MemoryOs {
        fn new() -> Self {
            Self {
                map: Mutex::new(HashMap::new()),
            }
        }
    }

    impl OsSecrets for MemoryOs {
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            self.map
                .lock()
                .expect("os")
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }

        fn get(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self.map.lock().expect("os").get(account).cloned())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            self.map.lock().expect("os").remove(account);
            Ok(())
        }
    }

    #[test]
    fn guardar_existe_y_borrar() {
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
        let os = MemoryOs::new();
        let mut session = Session::default();
        save(&mut session, &os, "openai", "vieja", false).expect("sesión");
        migrate(&mut session, &os, "openai", "nueva").expect("migrar");
        assert!(session.keys.is_empty());
        assert_eq!(os.get("openai").expect("os").as_deref(), Some("nueva"));
        assert!(exists(&session, &os, "openai").expect("sigue"));
        assert_eq!(lookup(&session, &os, "openai").expect("leer"), "nueva");
    }

    #[test]
    fn recordar_quita_la_copia_del_sistema_si_la_sesion_manda() {
        let os = MemoryOs::new();
        let mut session = Session::default();
        save(&mut session, &os, "anthropic", "persistida", true).expect("sistema");
        save(&mut session, &os, "anthropic", "efímera", false).expect("sesión");
        assert!(os.get("anthropic").expect("os").is_none());
        assert_eq!(lookup(&session, &os, "anthropic").expect("leer"), "efímera");
    }

    #[test]
    fn un_proveedor_ajeno_no_entra() {
        let os = MemoryOs::new();
        let mut session = Session::default();
        assert!(save(&mut session, &os, "otro", "x", true).is_err());
        assert!(exists(&session, &os, "otro").is_err());
    }
}

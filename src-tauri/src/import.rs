//! Clonación de un repositorio de GitHub hacia una carpeta que eligió el usuario.
//!
//! No hay shell: `git` se ejecuta con una lista de argumentos fija. La URL se
//! reescribe a `https://github.com/dueño/repo.git` o `git@github.com:dueño/repo.git`
//! después de aceptar sólo esos dos formatos. El destino es un único componente
//! de ruta bajo la carpeta que devolvió el diálogo nativo.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::win_cmd;

/// Un clon que sigue vivo después de este plazo se mata y se borra el destino.
const CLONE_LIMIT: Duration = Duration::from_secs(600);

/// Remote ya normalizado: la cadena que recibe `git` y el nombre de carpeta.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRemote {
    /// URL que se pasa a `git clone`, sin query ni credenciales.
    pub clone_url: String,
    /// Un solo componente de ruta, sin `.git`.
    pub dir_name: String,
}

/// Acepta HTTPS o SSH de `github.com` y rechaza el resto.
pub fn github_remote(raw: &str) -> Result<GitRemote, String> {
    let url = raw.trim();
    if url.is_empty() || url.len() > 200 {
        return Err("la URL de GitHub está vacía o es demasiado larga".to_string());
    }
    if url.chars().any(|char| {
        char.is_control()
            || matches!(
                char,
                ' ' | '"' | '\'' | '\\' | '`' | '$' | '|' | '&' | ';' | '<' | '>' | '(' | ')'
            )
    }) {
        return Err("la URL contiene caracteres no permitidos".to_string());
    }

    let (ssh, rest) = if let Some(rest) = url.strip_prefix("https://github.com/") {
        (false, rest)
    } else if let Some(rest) = url.strip_prefix("ssh://git@github.com/") {
        (true, rest)
    } else if let Some(rest) = url.strip_prefix("git@github.com:") {
        (true, rest)
    } else {
        return Err("sólo se aceptan URL https o ssh de github.com".to_string());
    };

    let (owner, repo) = owner_and_repo(rest)?;
    let dir_name = repo.clone();
    let clone_url = if ssh {
        format!("git@github.com:{owner}/{repo}.git")
    } else {
        format!("https://github.com/{owner}/{repo}.git")
    };
    Ok(GitRemote {
        clone_url,
        dir_name,
    })
}

fn owner_and_repo(rest: &str) -> Result<(String, String), String> {
    let rest = rest.trim_end_matches('/');
    if rest.contains(['?', '#', '@', ':']) {
        return Err("la URL no puede llevar credenciales, query ni puerto".to_string());
    }
    let mut parts = rest.split('/');
    let owner = parts.next().unwrap_or("");
    let repo = parts.next().unwrap_or("");
    if parts.next().is_some() {
        return Err("la URL sólo puede tener dueño y repositorio".to_string());
    }
    validate_component(owner, "dueño")?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    validate_component(repo, "repositorio")?;
    Ok((owner.to_string(), repo.to_string()))
}

fn validate_component(name: &str, what: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > 100
        || name.starts_with('.')
        || name.ends_with('.')
    {
        return Err(format!("el {what} de GitHub no es válido"));
    }
    if !name
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '_' | '-'))
    {
        return Err(format!(
            "el {what} sólo puede usar letras, números, punto, guion y subrayado"
        ));
    }
    Ok(())
}

/// Carpeta `parent/nombre`, todavía inexistente y sin salirse del padre.
fn destination(parent: &Path, name: &str) -> Result<PathBuf, String> {
    if name.contains(['/', '\\']) || name.contains("..") {
        return Err("el nombre del repositorio no es un único componente".to_string());
    }
    let dest = parent.join(name);
    if dest.exists() {
        return Err(format!(
            "ya existe «{}»: elige otra carpeta o borra ese directorio",
            dest.display()
        ));
    }
    Ok(dest)
}

/// Clona `url` dentro de `parent` y devuelve la ruta canónica del repositorio.
///
/// `git` no recibe más argumentos que `clone --progress -- <url> <dest>`.
/// Si el proceso falla, se borra sólo el directorio que este comando creó.
pub fn clone_repository(app: &AppHandle, parent: &Path, url: &str) -> Result<PathBuf, String> {
    let remote = github_remote(url)?;
    let dest = destination(parent, &remote.dir_name)?;
    let _ = app.emit(
        "github-clone-progress",
        format!("clonando {}…", remote.dir_name),
    );

    let mut git = Command::new("git");
    git.args([
        "clone",
        "--progress",
        "--",
        remote.clone_url.as_str(),
        &dest.display().to_string(),
    ])
    .env("GIT_TERMINAL_PROMPT", "0")
    .env("GCM_INTERACTIVE", "Never")
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
    win_cmd::hide_console(&mut git);
    let mut child = git
        .spawn()
        .map_err(|err| format!("no se pudo ejecutar git ({err}). ¿Está en el PATH?"))?;

    let child_stderr = child.stderr.take();
    let app_progress = app.clone();
    let reader = thread::spawn(move || {
        let mut last_line = String::new();
        let Some(mut stderr) = child_stderr else {
            return last_line;
        };
        let mut buf = [0u8; 512];
        let mut pending = String::new();
        while let Ok(read) = stderr.read(&mut buf) {
            if read == 0 {
                break;
            }
            pending.push_str(&String::from_utf8_lossy(&buf[..read]));
            while let Some(index) = pending.find(['\r', '\n']) {
                let line: String = pending.drain(..=index).collect();
                let shown = line.trim();
                if shown.is_empty() {
                    continue;
                }
                let shown: String = shown.chars().take(180).collect();
                last_line.clone_from(&shown);
                let _ = app_progress.emit("github-clone-progress", shown.clone());
            }
        }
        last_line
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() >= CLONE_LIMIT => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                if dest.exists() {
                    let _ = fs::remove_dir_all(&dest);
                }
                return Err("git clone superó los 10 minutos y se detuvo".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(err) => {
                let _ = child.kill();
                let _ = reader.join();
                return Err(format!("git no terminó: {err}"));
            }
        }
    };
    let last_line = reader.join().unwrap_or_default();
    if !status.success() {
        if dest.exists() {
            let _ = fs::remove_dir_all(&dest);
        }
        let detail = if last_line.is_empty() {
            format!("código {}", status.code().unwrap_or(-1))
        } else {
            last_line
        };
        return Err(format!("git clone falló: {detail}"));
    }

    let canonical =
        fs::canonicalize(&dest).map_err(|err| format!("el clon no se pudo abrir: {err}"))?;
    if !canonical.starts_with(parent) {
        return Err("el clon quedó fuera de la carpeta elegida".to_string());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acepta_https_y_normaliza_el_directorio() {
        let remote = github_remote("https://github.com/acme/bara-lib.git").expect("https");
        assert_eq!(remote.clone_url, "https://github.com/acme/bara-lib.git");
        assert_eq!(remote.dir_name, "bara-lib");
    }

    #[test]
    fn acepta_ssh_corto_y_ssh_url() {
        let corto = github_remote("git@github.com:acme/demo").expect("ssh corto");
        assert_eq!(corto.clone_url, "git@github.com:acme/demo.git");
        assert_eq!(corto.dir_name, "demo");

        let largo = github_remote("ssh://git@github.com/acme/demo.git/").expect("ssh url");
        assert_eq!(largo.clone_url, "git@github.com:acme/demo.git");
    }

    #[test]
    fn rechaza_otros_hosts_credenciales_y_escapes() {
        for url in [
            "http://github.com/acme/demo",
            "https://gitlab.com/acme/demo",
            "https://user:token@github.com/acme/demo",
            "https://github.com/acme/demo?foo=1",
            "https://github.com/acme/../demo",
            "https://github.com/acme/demo/extra",
            "https://github.com/acme/demo.git && calc",
            "git@github.com:acme/../../etc",
        ] {
            assert!(github_remote(url).is_err(), "{url} debió rechazarse");
        }
    }
}

//! Git integrado sobre la jaula activa (A6).
//!
//! Sólo status / diff / commit / ramas / checkout. Nunca push, reset --hard,
//! force push ni clean -fdx desde este módulo.

#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::win_cmd;

const OUT_CAP: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusReport {
    pub root: String,
    pub branch: String,
    pub dirty: bool,
    pub entries: Vec<GitStatusEntry>,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    pub index: String,
    pub worktree: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffReport {
    pub root: String,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchReport {
    pub root: String,
    pub current: String,
    pub branches: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitReport {
    pub root: String,
    pub ok: bool,
    pub summary: String,
}

fn git_bin() -> &'static str {
    "git"
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<(i32, String, String), String> {
    let mut command = Command::new(git_bin());
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    win_cmd::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|err| format!("no se pudo lanzar git: {err}"))?;
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        use std::io::Read;
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        stdout = String::from_utf8_lossy(&buf)
            .chars()
            .take(OUT_CAP)
            .collect();
    }
    if let Some(mut err) = child.stderr.take() {
        use std::io::Read;
        let mut buf = Vec::new();
        let _ = err.read_to_end(&mut buf);
        stderr = String::from_utf8_lossy(&buf)
            .chars()
            .take(OUT_CAP)
            .collect();
    }
    let status = child
        .wait()
        .map_err(|err| format!("git no terminó: {err}"))?;
    let code = status.code().unwrap_or(-1);
    Ok((code, stdout, stderr))
}

fn ensure_repo(root: &str) -> Result<PathBuf, String> {
    let cwd = PathBuf::from(root);
    if !cwd.is_dir() {
        return Err("la raíz del workspace no existe".to_string());
    }
    let (code, _, err) = run_git(&cwd, &["rev-parse", "--is-inside-work-tree"])?;
    if code != 0 {
        return Err(if err.trim().is_empty() {
            "la carpeta no es un repositorio git".to_string()
        } else {
            err.trim().to_string()
        });
    }
    Ok(cwd)
}

/// Estado porcelain + rama actual.
pub fn status(root: &str) -> Result<GitStatusReport, String> {
    let cwd = ensure_repo(root)?;
    let (_, branch_out, _) = run_git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = branch_out.trim().to_string();
    let (code, raw, err) = run_git(&cwd, &["status", "--porcelain=v1", "-uall"])?;
    if code != 0 {
        return Err(err.trim().to_string());
    }
    let mut entries = Vec::new();
    for line in raw.lines() {
        if line.len() < 3 {
            continue;
        }
        let index = line.chars().next().unwrap_or(' ').to_string();
        let worktree = line.chars().nth(1).unwrap_or(' ').to_string();
        let path = line[3..].trim().replace('\\', "/");
        if path.is_empty() {
            continue;
        }
        entries.push(GitStatusEntry {
            path,
            index,
            worktree,
        });
    }
    Ok(GitStatusReport {
        root: root.replace('\\', "/"),
        branch,
        dirty: !entries.is_empty(),
        entries,
        raw,
    })
}

/// Diff unificado (trabajo + índice). Sin pager.
pub fn diff(root: &str) -> Result<GitDiffReport, String> {
    let cwd = ensure_repo(root)?;
    let (head_ok, _, _) = run_git(&cwd, &["rev-parse", "--verify", "HEAD"])?;
    let args: &[&str] = if head_ok == 0 {
        &["--no-pager", "diff", "--no-ext-diff", "--no-color", "HEAD"]
    } else {
        &["--no-pager", "diff", "--no-ext-diff", "--no-color"]
    };
    let (code, patch, err) = run_git(&cwd, args)?;
    // code 0/1 son normales en diff; >1 es fallo.
    if code > 1 {
        return Err(err.trim().to_string());
    }
    let patch = if patch.trim().is_empty() {
        let (code2, untracked_hint, _) = run_git(&cwd, &["status", "--porcelain=v1"])?;
        if code2 == 0 && !untracked_hint.trim().is_empty() {
            format!("# sin diff frente a HEAD (hay cambios sin seguimiento)\n{untracked_hint}")
        } else {
            String::new()
        }
    } else {
        patch
    };
    Ok(GitDiffReport {
        root: root.replace('\\', "/"),
        patch,
    })
}

/// Lista ramas locales.
pub fn branches(root: &str) -> Result<GitBranchReport, String> {
    let cwd = ensure_repo(root)?;
    let (_, current_out, _) = run_git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let current = current_out.trim().to_string();
    let (code, list, err) = run_git(&cwd, &["branch", "--format=%(refname:short)"])?;
    if code != 0 {
        return Err(err.trim().to_string());
    }
    let branches = list
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    Ok(GitBranchReport {
        root: root.replace('\\', "/"),
        current,
        branches,
    })
}

const BARA_EXCLUDE_LINES: &[&str] = &[".bara-backup/", ".bara-trash/"];

/// Lista que el diálogo nativo muestra antes de `git commit`.
/// El WebView no puede aceptar el commit por su cuenta.
#[derive(Debug, Clone)]
pub struct CommitPreview {
    pub files: Vec<String>,
    pub secrets: Vec<String>,
}

/// Si la carpeta es un repo, añade `.bara-backup/` y `.bara-trash/` a
/// `.git/info/exclude`. No toca el `.gitignore` del usuario.
pub fn ensure_bara_exclude(root: &str) -> Result<(), String> {
    let Ok(cwd) = ensure_repo(root) else {
        return Ok(());
    };
    write_exclude(&cwd)
}

fn write_exclude(cwd: &Path) -> Result<(), String> {
    let (code, out, err) = run_git(cwd, &["rev-parse", "--git-path", "info/exclude"])?;
    if code != 0 {
        return Err(if err.trim().is_empty() {
            "no se pudo localizar info/exclude".to_string()
        } else {
            err.trim().to_string()
        });
    }
    let rel = out.trim();
    let path = {
        let candidate = PathBuf::from(rel);
        if candidate.is_absolute() {
            candidate
        } else {
            cwd.join(candidate)
        }
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("no se pudo crear info/: {err}"))?;
    }
    let mut text = if path.is_file() {
        std::fs::read_to_string(&path).map_err(|err| format!("no se pudo leer exclude: {err}"))?
    } else {
        String::new()
    };
    let mut changed = false;
    for line in BARA_EXCLUDE_LINES {
        if !exclude_has(&text, line) {
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(line);
            text.push('\n');
            changed = true;
        }
    }
    if changed {
        std::fs::write(&path, text).map_err(|err| format!("no se pudo escribir exclude: {err}"))?;
    }
    Ok(())
}

fn exclude_has(text: &str, needle: &str) -> bool {
    let bare = needle.trim_end_matches('/');
    text.lines().any(|line| {
        let trimmed = line.trim();
        trimmed == needle || trimmed == bare
    })
}

fn is_bara_private(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    let normalized = normalized.trim_start_matches("./");
    normalized == ".bara-backup"
        || normalized.starts_with(".bara-backup/")
        || normalized == ".bara-trash"
        || normalized.starts_with(".bara-trash/")
}

fn looks_like_secret(path: &str) -> bool {
    let name = path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_ascii_lowercase();
    name.starts_with(".env")
        || name.ends_with(".key")
        || name.ends_with(".pem")
        || name.starts_with("id_rsa")
        || name.ends_with(".pfx")
        || name.ends_with(".p12")
        || name.ends_with(".keystore")
        || name == ".npmrc"
        || name == ".git-credentials"
        || name == "keystore.properties"
}

fn staged_names(cwd: &Path) -> Result<Vec<String>, String> {
    let (code, out, err) = run_git(cwd, &["diff", "--cached", "--name-only", "-z"])?;
    if code != 0 {
        return Err(err.trim().to_string());
    }
    Ok(out
        .split('\0')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| name.replace('\\', "/"))
        .collect())
}

fn unstage_all(cwd: &Path) -> Result<(), String> {
    let (head, _, _) = run_git(cwd, &["rev-parse", "--verify", "HEAD"])?;
    if head == 0 {
        let (code, _, err) = run_git(cwd, &["reset", "-q"])?;
        if code != 0 {
            return Err(err.trim().to_string());
        }
        return Ok(());
    }
    let (code, _, err) = run_git(
        cwd,
        &["rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", "."],
    )?;
    if code != 0 {
        return Err(err.trim().to_string());
    }
    Ok(())
}

fn add_only_ignored(stderr: &str) -> bool {
    let mut saw_ignored = false;
    for line in stderr.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with("hint:")
            || line.starts_with("warning:")
            || line.starts_with(".bara-backup")
            || line.starts_with(".bara-trash")
        {
            continue;
        }
        if line.contains("ignored by one of your .gitignore") {
            saw_ignored = true;
            continue;
        }
        return false;
    }
    saw_ignored
}

fn validate_message(message: &str) -> Result<&str, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("el mensaje de commit está vacío".to_string());
    }
    if msg.len() > 4000 {
        return Err("el mensaje de commit supera 4000 caracteres".to_string());
    }
    if msg.contains('\0') {
        return Err("el mensaje de commit no puede llevar NUL".to_string());
    }
    Ok(msg)
}

/// Prepara el índice sin `.bara-backup/` ni `.bara-trash/` y devuelve la lista.
pub fn stage_for_commit(root: &str) -> Result<CommitPreview, String> {
    let cwd = ensure_repo(root)?;
    write_exclude(&cwd)?;
    let _ = run_git(&cwd, &["reset", "-q", "--", ".bara-backup", ".bara-trash"]);
    let (code_add, _, err_add) = run_git(
        &cwd,
        &[
            "add",
            "-A",
            "--",
            ".",
            ":(exclude).bara-backup",
            ":(exclude).bara-trash",
        ],
    )?;
    // Git sale con código 1 si el pathspec nombra una ruta ya ignorada por
    // info/exclude. No es un fallo si el índice no se llevó esas carpetas.
    if code_add != 0 && !add_only_ignored(&err_add) {
        return Err(err_add.trim().to_string());
    }
    let files = staged_names(&cwd)?;
    if files.iter().any(|path| is_bara_private(path)) {
        let _ = unstage_all(&cwd);
        return Err("el índice incluye .bara-backup o .bara-trash; no se confirma".to_string());
    }
    let secrets = files
        .iter()
        .filter(|path| looks_like_secret(path))
        .cloned()
        .collect();
    Ok(CommitPreview { files, secrets })
}

/// Texto del diálogo nativo. Los secretos van primero para que se vean.
pub fn commit_dialog_text(preview: &CommitPreview) -> String {
    let mut out = String::new();
    if !preview.secrets.is_empty() {
        out.push_str("AVISO: estos archivos parecen secretos y entrarían en el commit:\n");
        for path in &preview.secrets {
            out.push_str("  ");
            out.push_str(path);
            out.push('\n');
        }
        out.push('\n');
    }
    out.push_str(&format!(
        "Archivos que entran en el commit ({}):\n",
        preview.files.len()
    ));
    for (index, path) in preview.files.iter().enumerate() {
        if index >= 200 {
            out.push_str(&format!("  … y {} más\n", preview.files.len() - index));
            break;
        }
        out.push_str("  ");
        out.push_str(path);
        out.push('\n');
    }
    out.push_str("\n¿Crear el commit?");
    out
}

/// Confirma o deshace el índice preparado. `accepted` sale del diálogo nativo.
pub fn finish_commit(root: &str, message: &str, accepted: bool) -> Result<GitCommitReport, String> {
    let msg = validate_message(message)?;
    let cwd = ensure_repo(root)?;
    if !accepted {
        unstage_all(&cwd)?;
        return Err("cancelado".to_string());
    }
    let files = staged_names(&cwd)?;
    if files.iter().any(|path| is_bara_private(path)) {
        let _ = unstage_all(&cwd);
        return Err("el índice incluye .bara-backup o .bara-trash; no se confirma".to_string());
    }
    if files.is_empty() {
        return Err("no hay cambios para confirmar".to_string());
    }
    let (code, out, err) = run_git(&cwd, &["commit", "-m", msg])?;
    if code != 0 {
        let detail = if err.trim().is_empty() {
            out.trim().to_string()
        } else {
            err.trim().to_string()
        };
        return Err(detail);
    }
    Ok(GitCommitReport {
        root: root.replace('\\', "/"),
        ok: true,
        summary: out.trim().lines().next().unwrap_or("commit").to_string(),
    })
}

/// Cambia o crea rama (`checkout` / `checkout -b`). Sin force.
pub fn checkout(root: &str, name: &str, create: bool) -> Result<GitBranchReport, String> {
    let branch = name.trim();
    if branch.is_empty() || branch.len() > 200 {
        return Err("nombre de rama inválido".to_string());
    }
    if branch.starts_with('-')
        || branch.contains("..")
        || branch.contains([' ', '\\', ':', '~', '^', '?', '*', '[', ']'])
    {
        return Err("nombre de rama no permitido".to_string());
    }
    let cwd = ensure_repo(root)?;
    let args: Vec<&str> = if create {
        vec!["checkout", "-b", branch]
    } else {
        vec!["checkout", branch]
    };
    let (code, _, err) = run_git(&cwd, &args)?;
    if code != 0 {
        return Err(err.trim().to_string());
    }
    branches(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bara-git-{nonce}"));
        fs::create_dir_all(&dir).expect("dir");
        dir
    }

    fn git_init(dir: &Path) {
        let (code, _, err) = run_git(dir, &["init"]).expect("init");
        assert_eq!(code, 0, "{err}");
        let _ = run_git(dir, &["config", "user.email", "bara@test.local"]);
        let _ = run_git(dir, &["config", "user.name", "Bara Test"]);
    }

    #[test]
    fn a6_status_diff_commit_y_rama() {
        let dir = scratch();
        git_init(&dir);
        fs::write(dir.join("nota.md"), "hola\n").expect("write");
        let root = dir.to_str().expect("utf8");
        let st = status(root).expect("status");
        assert!(st.dirty);
        assert!(!st.entries.is_empty());
        let before = diff(root).expect("diff sin HEAD");
        assert!(!before.patch.is_empty());
        let preview = stage_for_commit(root).expect("stage");
        assert!(preview.files.iter().any(|path| path == "nota.md"));
        let done = finish_commit(root, "chore: semilla a6", true).expect("commit");
        assert!(done.ok);
        let clean = status(root).expect("clean");
        assert!(!clean.dirty);
        let _ = diff(root).expect("diff tras commit");
        let branched = checkout(root, "feat/a6", true).expect("branch");
        assert_eq!(branched.current, "feat/a6");
        assert!(branched.branches.iter().any(|b| b == "feat/a6"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn n2_el_commit_no_incluye_respaldo_ni_papelera() {
        let dir = scratch();
        git_init(&dir);
        fs::create_dir_all(dir.join(".bara-backup")).expect("backup");
        fs::create_dir_all(dir.join(".bara-trash")).expect("trash");
        fs::write(dir.join(".bara-backup").join("x"), "bak").expect("x");
        fs::write(dir.join(".bara-trash").join("y"), "trash").expect("y");
        fs::write(dir.join("nota.md"), "hola\n").expect("nota");
        let root = dir.to_str().expect("utf8");
        ensure_bara_exclude(root).expect("exclude");
        let exclude =
            fs::read_to_string(dir.join(".git").join("info").join("exclude")).expect("leer");
        assert!(exclude.contains(".bara-backup/"));
        assert!(exclude.contains(".bara-trash/"));
        let preview = stage_for_commit(root).expect("stage");
        assert_eq!(preview.files, vec!["nota.md".to_string()]);
        assert!(preview.secrets.is_empty());
        assert!(!commit_dialog_text(&preview).contains(".bara-backup"));
        finish_commit(root, "chore: n2", true).expect("commit");
        let (code, stat, err) = run_git(&dir, &["show", "--stat", "--format="]).expect("show");
        assert_eq!(code, 0, "{err}");
        assert!(stat.contains("nota.md"), "{stat}");
        assert!(!stat.contains(".bara-backup"), "{stat}");
        assert!(!stat.contains(".bara-trash"), "{stat}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn n2_marca_secretos_y_cancelar_no_confirma() {
        let dir = scratch();
        git_init(&dir);
        fs::write(dir.join("nota.md"), "hola\n").expect("nota");
        let root = dir.to_str().expect("utf8");
        stage_for_commit(root).expect("stage inicial");
        finish_commit(root, "chore: base", true).expect("base");
        let secretos = [
            ".env",
            ".env.local",
            "clave.key",
            "cert.pem",
            "id_rsa",
            "id_rsa_backup",
            "tienda.pfx",
            "tienda.p12",
            "app.keystore",
            ".npmrc",
            ".git-credentials",
            "keystore.properties",
        ];
        for name in secretos {
            fs::write(dir.join(name), "secreto\n").expect(name);
        }
        fs::write(dir.join("nota.md"), "cambio\n").expect("nota2");
        let preview = stage_for_commit(root).expect("stage");
        for name in secretos {
            assert!(
                preview.secrets.iter().any(|path| path == name),
                "falta {name} en {:?}",
                preview.secrets
            );
        }
        assert!(preview.secrets.iter().all(|path| path != "nota.md"));
        let dialog = commit_dialog_text(&preview);
        assert!(dialog.contains("parecen secretos"));
        assert!(dialog.contains(".env"));
        assert!(finish_commit(root, "chore: no", false).is_err());
        let (code, cached, _) =
            run_git(&dir, &["diff", "--cached", "--name-only"]).expect("cached");
        assert_eq!(code, 0);
        assert!(cached.trim().is_empty(), "{cached}");
        let (head, _, _) = run_git(&dir, &["rev-parse", "HEAD"]).expect("head");
        assert_eq!(head, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a6_no_acepta_nombre_de_rama_peligroso() {
        let dir = scratch();
        git_init(&dir);
        let root = dir.to_str().expect("utf8");
        assert!(checkout(root, "-f", false).is_err());
        assert!(checkout(root, "a..b", true).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}

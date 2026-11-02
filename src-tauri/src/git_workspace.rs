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

/// `git add -A` + `git commit -m`. Sin push.
///
/// `confirmed` es la segunda confirmación: sin ella no se hace `add -A`.
pub fn commit(root: &str, message: &str, confirmed: bool) -> Result<GitCommitReport, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("el mensaje de commit está vacío".to_string());
    }
    if !confirmed {
        return Err(
            "segunda confirmación: git add -A abarca todo el árbol; confirma otra vez".to_string(),
        );
    }
    if msg.len() > 4000 {
        return Err("el mensaje de commit supera 4000 caracteres".to_string());
    }
    if msg.contains('\0') {
        return Err("el mensaje de commit no puede llevar NUL".to_string());
    }
    let cwd = ensure_repo(root)?;
    let (code_add, _, err_add) = run_git(&cwd, &["add", "-A"])?;
    if code_add != 0 {
        return Err(err_add.trim().to_string());
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
        assert!(
            commit(root, "chore: semilla a6", false).is_err(),
            "sin segunda confirmación no hay git add -A"
        );
        assert!(status(root).expect("sigue sucio").dirty);
        let done = commit(root, "chore: semilla a6", true).expect("commit");
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
    fn a6_no_acepta_nombre_de_rama_peligroso() {
        let dir = scratch();
        git_init(&dir);
        let root = dir.to_str().expect("utf8");
        assert!(checkout(root, "-f", false).is_err());
        assert!(checkout(root, "a..b", true).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}

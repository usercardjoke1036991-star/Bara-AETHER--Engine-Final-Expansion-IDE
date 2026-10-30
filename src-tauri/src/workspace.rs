//! Explorador y almacén del workspace del IDE.
//!
//! Este módulo es el **único** punto del backend que toca el disco del
//! workspace. Su contrato es deliberadamente pequeño:
//!
//! * `tree(root)` enumera el árbol de directorios, ignorando `target/`,
//!   `node_modules/` y `.git/`, sin seguir enlaces simbólicos.
//! * `read(root, path)` y `write(root, path, source)` sólo aceptan documentos
//!   `.bara` **dentro** de la raíz canónica del workspace.
//!
//! La validación de rutas no es cosmética: una ruta relativa con `..`, una
//! ruta absoluta o un enlace simbólico que escape de la raíz se rechazan antes
//! de leer o escribir. Así el IPC no puede convertirse en un lector arbitrario
//! del sistema de archivos.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Directorios que nunca se enumeran (artefactos y metadatos del repositorio).
const EXCLUDED_DIRS: [&str; 4] = ["target", "node_modules", ".git", ".bara-backup"];

/// Cota de profundidad del árbol (evita ciclos patológicos de junctions).
const MAX_DEPTH: usize = 24;

/// Cota de entradas que se enumeran por petición.
const MAX_ENTRIES: usize = 4_000;

/// Cota del tamaño de un documento `.bara` que el editor carga o guarda.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Cota del árbol y de la herramienta «leer archivo» del asistente.
const MAX_TREE_FILE_BYTES: u64 = 1024 * 1024;

/// Tipo de entrada del árbol tal como lo consume React.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Dir,
    File,
}

/// Nodo del árbol del workspace.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    /// Nombre visible (un solo componente de ruta).
    pub name: String,
    /// Ruta relativa a la raíz, siempre con `/` como separador.
    pub path: String,
    /// Directorio o archivo.
    pub kind: EntryKind,
    /// `true` si el archivo es un documento editable `.bara`.
    pub bara: bool,
    /// Hijos de un directorio (vacío en archivos).
    pub children: Vec<WorkspaceEntry>,
}

/// Árbol completo del workspace.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTree {
    /// Raíz canónica (absoluta) que se está explorando.
    pub root: String,
    /// Nombre de la carpeta raíz.
    pub name: String,
    /// Entradas de primer nivel, ordenadas (carpetas antes que archivos).
    pub entries: Vec<WorkspaceEntry>,
    /// Número de archivos `.bara` encontrados.
    pub files: usize,
    /// `true` si la enumeración alcanzó una de sus cotas.
    pub truncated: bool,
}

/// Documento leído del workspace.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    /// Raíz canónica del workspace.
    pub root: String,
    /// Ruta relativa normalizada con `/`.
    pub path: String,
    /// Nombre del archivo.
    pub name: String,
    /// Contenido UTF-8 del documento.
    pub source: String,
}

/// Raíz por defecto del IDE: el workspace del repositorio, no `src-tauri/`.
///
/// `tauri dev` puede lanzar el binario con el directorio de trabajo dentro de
/// `src-tauri/`; en ese caso se asciende un nivel para no explorar sólo el
/// crate del backend. Si la ventana se lanzó desde otra carpeta, se respeta
/// ese directorio: el usuario siempre puede escribir otra ruta en la barra
/// lateral.
pub fn default_root() -> Result<String, String> {
    let current = std::env::current_dir()
        .map_err(|err| format!("no se pudo resolver el directorio actual: {err}"))?;
    let candidate = if current.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        current.parent().map(Path::to_path_buf).unwrap_or(current)
    } else {
        current
    };
    Ok(candidate.display().to_string())
}

/// Canoniza y valida la raíz del workspace.
pub fn resolve_root(root: &str) -> Result<PathBuf, String> {
    let trimmed = root.trim();
    let candidate = if trimmed.is_empty() {
        std::env::current_dir()
            .map_err(|err| format!("no se pudo resolver el directorio actual: {err}"))?
    } else {
        PathBuf::from(trimmed)
    };

    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()
            .map_err(|err| format!("no se pudo resolver el directorio actual: {err}"))?
            .join(candidate)
    };

    let canonical = fs::canonicalize(&absolute)
        .map_err(|err| format!("no se pudo abrir «{}»: {err}", absolute.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "«{}» no es un directorio de workspace",
            canonical.display()
        ));
    }
    Ok(canonical)
}

/// Enumera el árbol del workspace, sin seguir enlaces simbólicos.
pub fn tree(root: &str) -> Result<WorkspaceTree, String> {
    let canonical = resolve_root(root)?;
    let mut budget = MAX_ENTRIES;
    let mut files = 0usize;
    let (mut entries, truncated) = collect(&canonical, &canonical, "", 0, &mut budget, &mut files)?;
    // Windows: el mismo archivo no puede existir con dos capitalizaciones; si el
    // índice o un enumerator las duplica, el UI no debe mostrar dos nodos.
    dedupe_entries_case_insensitive(&mut entries);
    let files = count_bara(&entries);

    Ok(WorkspaceTree {
        root: canonical.display().to_string(),
        name: canonical
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| canonical.display().to_string()),
        entries,
        files,
        truncated,
    })
}

fn count_bara(entries: &[WorkspaceEntry]) -> usize {
    let mut n = 0usize;
    for entry in entries {
        if entry.bara {
            n += 1;
        }
        n += count_bara(&entry.children);
    }
    n
}

/// Conserva la primera aparición por path en minúsculas (ASCII).
fn dedupe_entries_case_insensitive(entries: &mut Vec<WorkspaceEntry>) {
    let mut seen = HashSet::new();
    entries.retain(|entry| {
        let key = entry.path.to_ascii_lowercase();
        seen.insert(key)
    });
    for entry in entries.iter_mut() {
        if !entry.children.is_empty() {
            dedupe_entries_case_insensitive(&mut entry.children);
        }
    }
}

/// Tope de carpetas abiertas a la vez. Cada una conserva su propia jaula.
pub const ROOT_CAP: usize = 8;

/// Una carpeta del estante, tal como la pinta el panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootView {
    /// Identificador estable: FNV-1a de la ruta canónica, no un reloj.
    pub id: String,
    /// Ruta canónica.
    pub path: String,
    /// Nombre de la carpeta.
    pub name: String,
    /// ¿Es la raíz cuyos documentos y cuyo ledger están activos?
    pub active: bool,
}

/// Estante de carpetas y la que está activa.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceShelf {
    /// Identificador de la raíz activa. Vacío si no hay ninguna.
    pub active_id: String,
    /// Carpetas abiertas, en orden de llegada.
    pub roots: Vec<WorkspaceRootView>,
}

struct RootSlot {
    id: String,
    path: String,
    name: String,
    /// Tic lógico del último uso. No es un reloj de pared.
    used: u64,
}

struct Shelf {
    slots: Vec<RootSlot>,
    active: usize,
    clock: u64,
}

/// Raíz canónica que los comandos de disco —nuevos y heredados— comparten.
///
/// El estante puede guardar varias carpetas. Sólo una está activa: `read_document`
/// y `analyze_file` no eligen otra. Cada ruta, ya canonizada, sigue presa de
/// su propia raíz.
pub struct ActiveWorkspace {
    shelf: Mutex<Shelf>,
}

/// Identificador determinista de una ruta canónica.
pub fn root_id(path: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn folder_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

impl ActiveWorkspace {
    /// Raíz inicial: el workspace del repositorio, ya canonizado.
    pub fn bootstrap() -> Self {
        let mut shelf = Shelf {
            slots: Vec::new(),
            active: 0,
            clock: 0,
        };
        if let Some(path) = default_root()
            .ok()
            .and_then(|raw| resolve_root(&raw).ok())
            .map(|path| path.display().to_string())
        {
            shelf.admit(path);
        }
        Self {
            shelf: Mutex::new(shelf),
        }
    }

    /// Admite una raíz ya canonizada y la vuelve la activa.
    ///
    /// Si ya estaba en el estante, sólo se activa y se marca como recién usada.
    /// Si el estante está lleno, sale la carpeta inactiva con el tic más bajo.
    /// Devuelve la ruta expulsada para que el llamador ejecute `forget`.
    pub fn set(&self, root: String) -> Option<String> {
        match self.shelf.lock() {
            Ok(mut shelf) => shelf.admit(root),
            Err(_) => None,
        }
    }

    /// Estante vacío, sólo para pruebas de la política LRU.
    #[cfg(test)]
    pub(crate) fn empty() -> Self {
        Self {
            shelf: Mutex::new(Shelf {
                slots: Vec::new(),
                active: 0,
                clock: 0,
            }),
        }
    }

    /// Estante completo, para el panel.
    pub fn list(&self) -> Result<WorkspaceShelf, String> {
        let shelf = self
            .shelf
            .lock()
            .map_err(|_| "workspace no disponible (cerrojo envenenado)".to_string())?;
        Ok(shelf.view())
    }

    /// Activa una carpeta por su identificador. No acepta una ruta del WebView.
    pub fn activate(&self, id: &str) -> Result<WorkspaceShelf, String> {
        let mut shelf = self
            .shelf
            .lock()
            .map_err(|_| "workspace no disponible (cerrojo envenenado)".to_string())?;
        let Some(index) = shelf.slots.iter().position(|slot| slot.id == id) else {
            return Err("esa carpeta no está en el estante".to_string());
        };
        shelf.active = index;
        let used = shelf.tick();
        if let Some(slot) = shelf.slots.get_mut(index) {
            slot.used = used;
        }
        Ok(shelf.view())
    }

    /// Cierra una carpeta y devuelve su ruta canónica para soltar la malla.
    ///
    /// La última no se cierra: el IDE no se queda sin jaula y no se libera
    /// una memoria que sigue siendo la activa.
    pub fn release(&self, id: &str) -> Result<(String, WorkspaceShelf), String> {
        let mut shelf = self
            .shelf
            .lock()
            .map_err(|_| "workspace no disponible (cerrojo envenenado)".to_string())?;
        if shelf.slots.len() <= 1 {
            return Err("la última carpeta del estante no se cierra".to_string());
        }
        let Some(index) = shelf.slots.iter().position(|slot| slot.id == id) else {
            return Err("esa carpeta no está en el estante".to_string());
        };
        let path = shelf
            .slots
            .get(index)
            .map(|slot| slot.path.clone())
            .unwrap_or_default();
        shelf.slots.remove(index);
        if shelf.active > index {
            shelf.active -= 1;
        } else if shelf.active == index {
            shelf.active = index.min(shelf.slots.len().saturating_sub(1));
        }
        Ok((path, shelf.view()))
    }

    /// Raíz activa, o error si el cerrojo está envenenado o aún no hay ninguna.
    pub fn get(&self) -> Result<String, String> {
        match self.shelf.lock() {
            Ok(shelf) => shelf
                .slots
                .get(shelf.active)
                .map(|slot| slot.path.clone())
                .ok_or_else(|| "no hay un workspace activo".to_string()),
            Err(_) => Err("workspace no disponible (cerrojo envenenado)".to_string()),
        }
    }

    /// Lee un `.bara` confinándolo a la raíz activa.
    ///
    /// El IPC de producción usa [`read`], que sólo acepta rutas relativas.
    /// Esta entrada conserva la prueba del absoluto que sigue dentro de la jaula.
    #[cfg(test)]
    pub fn read_path(&self, path: &str) -> Result<WorkspaceDocument, String> {
        open_document(&self.get()?, path)
    }
}

impl Shelf {
    fn tick(&mut self) -> u64 {
        self.clock = self.clock.saturating_add(1);
        self.clock
    }

    /// `Some` es la ruta canónica expulsada por LRU. `None` si nadie salió.
    fn admit(&mut self, path: String) -> Option<String> {
        if let Some(index) = self.slots.iter().position(|slot| slot.path == path) {
            self.active = index;
            let used = self.tick();
            if let Some(slot) = self.slots.get_mut(index) {
                slot.used = used;
            }
            return None;
        }
        let mut evicted = None;
        if self.slots.len() >= ROOT_CAP {
            let drop_at = self
                .slots
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != self.active)
                .min_by_key(|(index, slot)| (slot.used, *index))
                .map(|(index, _)| index);
            if let Some(drop_at) = drop_at {
                let victim = self.slots.remove(drop_at);
                evicted = Some(victim.path);
                if self.active > drop_at {
                    self.active -= 1;
                }
            }
        }
        let used = self.tick();
        self.slots.push(RootSlot {
            id: root_id(&path),
            name: folder_name(&path),
            path,
            used,
        });
        self.active = self.slots.len().saturating_sub(1);
        evicted
    }

    fn view(&self) -> WorkspaceShelf {
        WorkspaceShelf {
            active_id: self
                .slots
                .get(self.active)
                .map(|slot| slot.id.clone())
                .unwrap_or_default(),
            roots: self
                .slots
                .iter()
                .enumerate()
                .map(|(index, slot)| WorkspaceRootView {
                    id: slot.id.clone(),
                    path: slot.path.clone(),
                    name: slot.name.clone(),
                    active: index == self.active,
                })
                .collect(),
        }
    }
}

/// Abre un `.bara` dentro de `root`, sea la ruta relativa o absoluta.
///
/// Rechaza `..`, cualquier componente que no sea un nombre normal en rutas
/// relativas, extensiones que no sean `.bara` y todo lo que, una vez
/// canonizado (enlaces incluidos), quede fuera de la raíz. El IPC no la usa:
/// los comandos llaman a [`read`] y [`write`], que exigen una ruta relativa.
#[cfg(test)]
pub fn open_document(root: &str, path: &str) -> Result<WorkspaceDocument, String> {
    if path.trim().is_empty() {
        return Err("la ruta del documento está vacía".to_string());
    }
    if has_parent_component(path) {
        return Err(format!(
            "la ruta «{path}» contiene componentes no permitidos"
        ));
    }
    if Path::new(path).is_absolute() {
        open_absolute(root, path)
    } else {
        read(root, path)
    }
}

/// Extensiones que el grafo y el salto al editor pueden leer. La escritura sigue
/// siendo sólo `.bara`.
const SOURCE_EXTENSIONS: [&str; 14] = [
    "bara", "rs", "py", "go", "sol", "c", "h", "cpp", "cc", "hpp", "js", "jsx", "ts", "tsx",
];

/// Extensiones de texto que el asistente puede leer (solo lectura).
const ASSISTANT_EXTENSIONS: [&str; 22] = [
    "bara", "rs", "py", "go", "sol", "c", "h", "cpp", "cc", "hpp", "js", "jsx", "ts", "tsx", "md",
    "txt", "json", "toml", "yaml", "yml", "css", "html",
];

/// ¿El archivo es una fuente del proyecto, dentro de la jaula de lectura?
pub(crate) fn is_project_source(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SOURCE_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

/// Lee una fuente del proyecto (`.bara` o un lenguaje del grafo).
///
/// Misma jaula que [`read`]: ruta relativa, sin `..`, y la forma canónica tiene
/// que seguir dentro de la raíz. No escribe.
pub fn read_text(root: &str, relative: &str) -> Result<WorkspaceDocument, String> {
    let canonical_root = resolve_root(root)?;
    let canonical = resolve_member(&canonical_root, relative)?;
    if !is_project_source(&canonical) {
        return Err(format!("«{relative}» no es una fuente del proyecto"));
    }
    ensure_file_size(&canonical)?;
    let source = fs::read_to_string(&canonical)
        .map_err(|err| format!("no se pudo leer «{relative}»: {err}"))?;
    Ok(WorkspaceDocument {
        root: canonical_root.display().to_string(),
        path: normalize_relative(relative),
        name: file_name(&canonical),
        source,
    })
}

/// Lectura de solo lectura para el asistente (cota 1 MiB, sin salir de la jaula).
pub fn read_assistant(root: &str, relative: &str) -> Result<WorkspaceDocument, String> {
    let canonical_root = resolve_root(root)?;
    let canonical = resolve_member(&canonical_root, relative)?;
    let allowed = canonical
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ASSISTANT_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        });
    if !allowed {
        return Err(format!("«{relative}» no es un texto legible del proyecto"));
    }
    let metadata = fs::metadata(&canonical)
        .map_err(|err| format!("no se pudo inspeccionar «{relative}»: {err}"))?;
    if metadata.len() > MAX_TREE_FILE_BYTES {
        return Err(format!(
            "«{relative}» supera 1 MiB y el asistente no lo lee"
        ));
    }
    let source = fs::read_to_string(&canonical)
        .map_err(|err| format!("no se pudo leer «{relative}»: {err}"))?;
    Ok(WorkspaceDocument {
        root: canonical_root.display().to_string(),
        path: normalize_relative(relative),
        name: file_name(&canonical),
        source,
    })
}

/// Lee un `.bara` del workspace, validando que la ruta pertenezca a la raíz.
pub fn read(root: &str, relative: &str) -> Result<WorkspaceDocument, String> {
    let canonical_root = resolve_root(root)?;
    let canonical = resolve_member(&canonical_root, relative)?;
    ensure_bara(&canonical)?;
    ensure_file_size(&canonical)?;

    let source = fs::read_to_string(&canonical)
        .map_err(|err| format!("no se pudo leer «{relative}»: {err}"))?;

    Ok(WorkspaceDocument {
        root: canonical_root.display().to_string(),
        path: normalize_relative(relative),
        name: file_name(&canonical),
        source,
    })
}

/// Guarda un `.bara` dentro del workspace (guardado en caliente del editor).
pub fn write(root: &str, relative: &str, source: &str) -> Result<WorkspaceDocument, String> {
    let canonical_root = resolve_root(root)?;
    ensure_bara(Path::new(relative))?;
    if source.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "el documento supera la cota de {} bytes del editor",
            MAX_FILE_BYTES
        ));
    }

    let canonical = resolve_for_write(&canonical_root, relative)?;
    fs::write(&canonical, source)
        .map_err(|err| format!("no se pudo guardar «{relative}»: {err}"))?;

    Ok(WorkspaceDocument {
        root: canonical_root.display().to_string(),
        path: normalize_relative(relative),
        name: file_name(&canonical),
        source: source.to_string(),
    })
}

/// Guarda una fuente del proyecto (`.bara` o una extensión del lote).
///
/// La usa el modo autónomo después de un veredicto `∅`. La jaula es la misma
/// que [`write`]: ruta relativa, sin `..`, y la forma canónica dentro de la raíz.
pub fn write_source(root: &str, relative: &str, source: &str) -> Result<WorkspaceDocument, String> {
    let canonical_root = resolve_root(root)?;
    if !is_project_source(Path::new(relative)) {
        return Err(format!("«{relative}» no es una fuente del proyecto"));
    }
    if source.len() as u64 > MAX_FILE_BYTES {
        return Err(format!(
            "el documento supera la cota de {} bytes del editor",
            MAX_FILE_BYTES
        ));
    }
    let canonical = resolve_for_write(&canonical_root, relative)?;
    if !is_project_source(&canonical) {
        return Err(format!("«{relative}» no es una fuente del proyecto"));
    }
    fs::write(&canonical, source)
        .map_err(|err| format!("no se pudo guardar «{relative}»: {err}"))?;
    Ok(WorkspaceDocument {
        root: canonical_root.display().to_string(),
        path: normalize_relative(relative),
        name: file_name(&canonical),
        source: source.to_string(),
    })
}

// ─────────────────────────────────────────────────────────────────────────
// Enumeración
// ─────────────────────────────────────────────────────────────────────────

fn collect(
    root: &Path,
    dir: &Path,
    relative: &str,
    depth: usize,
    budget: &mut usize,
    files: &mut usize,
) -> Result<(Vec<WorkspaceEntry>, bool), String> {
    if depth >= MAX_DEPTH || *budget == 0 {
        return Ok((Vec::new(), true));
    }

    let reader =
        fs::read_dir(dir).map_err(|err| format!("no se pudo leer «{}»: {err}", dir.display()))?;
    let mut pending: Vec<(String, PathBuf, bool)> = Vec::new();

    for item in reader {
        let item = item.map_err(|err| format!("no se pudo leer «{}»: {err}", dir.display()))?;
        let file_type = item
            .file_type()
            .map_err(|err| format!("no se pudo inspeccionar «{}»: {err}", item.path().display()))?;
        // Los enlaces simbólicos se ignoran: no se sigue nada fuera de la raíz.
        if file_type.is_symlink() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() && is_excluded(&name) {
            continue;
        }
        pending.push((name, item.path(), file_type.is_dir()));
    }

    pending.sort_by(|left, right| {
        right.2.cmp(&left.2).then_with(|| {
            left.0
                .to_ascii_lowercase()
                .cmp(&right.0.to_ascii_lowercase())
        })
    });

    let mut entries = Vec::new();
    let mut truncated = false;
    for (name, path, is_dir) in pending {
        if *budget == 0 {
            truncated = true;
            break;
        }
        *budget -= 1;

        let child_relative = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };

        if is_dir {
            // `file_type().is_symlink()` no cubre todos los puntos de
            // reanálisis de Windows (por ejemplo, junctions). Canonizar la
            // carpeta antes de descender garantiza que ninguna enumeración
            // salga de la raíz canónica del workspace.
            let canonical_child = fs::canonicalize(&path)
                .map_err(|err| format!("no se pudo abrir «{}»: {err}", path.display()))?;
            if !canonical_child.starts_with(root) {
                truncated = true;
                continue;
            }
            let (children, child_truncated) = collect(
                root,
                &canonical_child,
                &child_relative,
                depth + 1,
                budget,
                files,
            )?;
            truncated |= child_truncated;
            entries.push(WorkspaceEntry {
                name,
                path: child_relative,
                kind: EntryKind::Dir,
                bara: false,
                children,
            });
        } else {
            // El asistente ignora archivos > 1 MiB (también en el árbol).
            let oversized = fs::metadata(&path)
                .map(|meta| meta.len() > MAX_TREE_FILE_BYTES)
                .unwrap_or(true);
            if oversized {
                continue;
            }
            let is_bara = is_bara(&path);
            if is_bara {
                *files += 1;
            }
            entries.push(WorkspaceEntry {
                name,
                path: child_relative,
                kind: EntryKind::File,
                bara: is_bara,
                children: Vec::new(),
            });
        }
    }

    Ok((entries, truncated))
}

fn is_excluded(name: &str) -> bool {
    EXCLUDED_DIRS
        .iter()
        .any(|excluded| name.eq_ignore_ascii_case(excluded))
}

// ─────────────────────────────────────────────────────────────────────────
// Validación de rutas
// ─────────────────────────────────────────────────────────────────────────

/// Abre un `.bara` absoluto sólo si su forma canónica sigue dentro de la raíz.
#[cfg(test)]
fn open_absolute(root: &str, path: &str) -> Result<WorkspaceDocument, String> {
    let canonical_root = resolve_root(root)?;
    let canonical = fs::canonicalize(Path::new(path))
        .map_err(|err| format!("no se pudo abrir «{path}»: {err}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(format!("«{path}» queda fuera del workspace"));
    }
    ensure_bara(&canonical)?;
    ensure_file_size(&canonical)?;
    let relative = canonical
        .strip_prefix(&canonical_root)
        .map_err(|_| format!("«{path}» queda fuera del workspace"))?;
    let source =
        fs::read_to_string(&canonical).map_err(|err| format!("no se pudo leer «{path}»: {err}"))?;
    Ok(WorkspaceDocument {
        root: canonical_root.display().to_string(),
        path: normalize_relative(&relative.to_string_lossy()),
        name: file_name(&canonical),
        source,
    })
}

/// `..` no se normaliza: se rechaza antes de tocar el disco.
#[cfg(test)]
fn has_parent_component(path: &str) -> bool {
    Path::new(path)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

/// Resuelve una ruta existente dentro de la raíz y rechaza cualquier escape.
fn resolve_member(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let member = safe_relative(relative)?;
    let canonical = fs::canonicalize(root.join(member))
        .map_err(|err| format!("no se pudo abrir «{relative}»: {err}"))?;
    if !canonical.starts_with(root) {
        return Err(format!("«{relative}» queda fuera del workspace"));
    }
    Ok(canonical)
}

/// Resuelve una ruta de escritura; permite crear un archivo nuevo cuyo padre
/// ya exista, pero nunca salir de la raíz canónica.
fn resolve_for_write(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let member = safe_relative(relative)?;
    let candidate = root.join(member);

    if candidate.exists() {
        let canonical = fs::canonicalize(&candidate)
            .map_err(|err| format!("no se pudo abrir «{relative}»: {err}"))?;
        if !canonical.starts_with(root) {
            return Err(format!("«{relative}» queda fuera del workspace"));
        }
        return Ok(canonical);
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| format!("«{relative}» no tiene un directorio padre válido"))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|err| format!("no se pudo abrir el directorio de «{relative}»: {err}"))?;
    if !canonical_parent.starts_with(root) {
        return Err(format!("«{relative}» queda fuera del workspace"));
    }
    let name = candidate
        .file_name()
        .ok_or_else(|| format!("«{relative}» no tiene nombre de archivo"))?;
    Ok(canonical_parent.join(name))
}

/// Sólo componentes normales: sin raíz, prefijo, `..` ni `.` explícitos.
pub(crate) fn safe_relative(relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.trim().is_empty() || path.is_absolute() {
        return Err("la ruta debe ser relativa al workspace".to_string());
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "la ruta «{relative}» contiene componentes no permitidos"
        ));
    }
    Ok(path.to_path_buf())
}

fn ensure_bara(path: &Path) -> Result<(), String> {
    if is_bara(path) {
        Ok(())
    } else {
        Err(format!(
            "«{}» no es un documento .bara del workspace",
            path.display()
        ))
    }
}

fn ensure_file_size(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|err| format!("no se pudo inspeccionar «{}»: {err}", path.display()))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "«{}» supera la cota de {} bytes del editor",
            path.display(),
            MAX_FILE_BYTES
        ));
    }
    Ok(())
}

fn is_bara(path: &Path) -> bool {
    path.extension()
        .map(|extension| extension.to_string_lossy().eq_ignore_ascii_case("bara"))
        .unwrap_or(false)
}

fn normalize_relative(relative: &str) -> String {
    relative.replace('\\', "/")
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj anterior a la época")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bara-workspace-{name}-{nonce}"));
        fs::create_dir_all(&dir).expect("crear carpeta de prueba");
        dir
    }

    #[test]
    fn el_arbol_excluye_artefactos_y_ordena_carpetas_primero() {
        let root = scratch("tree");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::create_dir_all(root.join("target")).expect("target");
        fs::create_dir_all(root.join("node_modules")).expect("node_modules");
        fs::create_dir_all(root.join(".git")).expect(".git");
        fs::write(root.join("src/main.bara"), "ברא").expect("main");
        fs::write(root.join("target/ignored.bara"), "x").expect("ignored");
        fs::write(root.join("README.md"), "texto").expect("readme");

        let tree = tree(root.to_str().expect("utf-8")).expect("árbol");
        assert_eq!(tree.files, 1);
        assert_eq!(tree.entries[0].name, "src");
        assert_eq!(tree.entries[0].kind, EntryKind::Dir);
        assert!(tree.entries.iter().all(|entry| entry.name != "target"));
        assert!(tree
            .entries
            .iter()
            .all(|entry| entry.name != "node_modules"));
        assert!(tree.entries.iter().all(|entry| entry.name != ".git"));
        assert_eq!(tree.entries[0].children[0].path, "src/main.bara");
        assert!(tree.entries[0].children[0].bara);

        fs::remove_dir_all(&root).expect("limpiar");
    }

    #[test]
    fn leer_y_guardar_un_bara_dentro_del_workspace() {
        let root = scratch("io");
        fs::create_dir_all(root.join("samples")).expect("samples");
        fs::write(root.join("samples/uno.bara"), "ברא").expect("semilla");

        let document = read(root.to_str().expect("utf-8"), "samples/uno.bara").expect("leer");
        assert_eq!(document.source, "ברא");

        let saved =
            write(root.to_str().expect("utf-8"), "samples/uno.bara", "ברא חדש").expect("guardar");
        assert_eq!(saved.path, "samples/uno.bara");
        assert_eq!(
            fs::read_to_string(root.join("samples/uno.bara")).expect("releer"),
            "ברא חדש"
        );

        fs::remove_dir_all(&root).expect("limpiar");
    }

    #[test]
    fn se_rechazan_escapes_y_extensiones_ajenas() {
        let root = scratch("guard");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::write(root.join("src/uno.bara"), "x").expect("uno");

        assert!(read(root.to_str().expect("utf-8"), "../secreto.bara").is_err());
        assert!(read(root.to_str().expect("utf-8"), "src/uno.txt").is_err());
        assert!(write(root.to_str().expect("utf-8"), "../fuera.bara", "x").is_err());
        assert!(write(root.to_str().expect("utf-8"), "src/nuevo.txt", "x").is_err());

        fs::remove_dir_all(&root).expect("limpiar");
    }

    #[test]
    fn el_arbol_no_sigue_una_raiz_que_no_existe() {
        let missing = std::env::temp_dir().join("bara-workspace-no-existe-xyz");
        assert!(tree(missing.to_str().expect("utf-8")).is_err());
    }

    #[test]
    fn open_document_confina_absolutos_y_rechaza_escapes() {
        let root = scratch("jaula");
        let outside = scratch("fuera");
        fs::write(root.join("ok.bara"), "ברא").expect("dentro");
        fs::write(root.join("nota.txt"), "no").expect("txt");
        fs::write(outside.join("secreto.bara"), "x").expect("fuera");

        let root_s = root.to_str().expect("utf-8");
        let inside = root.join("ok.bara");
        let opened =
            open_document(root_s, inside.to_str().expect("utf-8")).expect("absoluto dentro");
        assert_eq!(opened.source, "ברא");
        assert_eq!(opened.path.replace('\\', "/"), "ok.bara");

        assert!(open_document(
            root_s,
            outside.join("secreto.bara").to_str().expect("utf-8")
        )
        .is_err());
        assert!(open_document(root_s, root.join("nota.txt").to_str().expect("utf-8")).is_err());
        assert!(open_document(root_s, "../secreto.bara").is_err());
        let dotted = root
            .join("..")
            .join(outside.file_name().expect("nombre"))
            .join("secreto.bara");
        assert!(open_document(root_s, dotted.to_str().expect("utf-8")).is_err());

        let active = ActiveWorkspace::bootstrap();
        let _ = active.set(root_s.to_string());
        assert_eq!(active.read_path("ok.bara").expect("relativa").source, "ברא");
        assert!(active
            .read_path(outside.join("secreto.bara").to_str().expect("utf-8"))
            .is_err());

        fs::remove_dir_all(&root).expect("limpiar raíz");
        fs::remove_dir_all(&outside).expect("limpiar fuera");
    }

    #[test]
    fn el_estante_alterna_carpetas_sin_mezclar_sus_jaulas() {
        let first = scratch("estante-a");
        let second = scratch("estante-b");
        fs::write(first.join("a.bara"), "uno").expect("a");
        fs::write(second.join("b.bara"), "dos").expect("b");
        let first_s = first.to_str().expect("utf-8").to_string();
        let second_s = second.to_str().expect("utf-8").to_string();

        let active = ActiveWorkspace::bootstrap();
        let _ = active.set(first_s.clone());
        let _ = active.set(second_s.clone());
        assert_eq!(active.get().expect("activa"), second_s);
        assert_eq!(active.read_path("b.bara").expect("b").source, "dos");
        assert!(active.read_path("a.bara").is_err());

        let shelf = active.list().expect("estante");
        assert!(shelf.roots.iter().any(|slot| slot.path == first_s));
        assert!(shelf.roots.iter().any(|slot| slot.path == second_s));
        let first_id = root_id(&first_s);
        assert_ne!(first_id, root_id(&second_s));
        active.activate(&first_id).expect("volver");
        assert_eq!(active.get().expect("primera"), first_s);
        assert_eq!(active.read_path("a.bara").expect("a").source, "uno");
        assert!(active.read_path("b.bara").is_err());

        let before = active.list().expect("antes").roots.len();
        active.release(&root_id(&second_s)).expect("cerrar");
        assert_eq!(active.list().expect("queda").roots.len(), before - 1);
        loop {
            let current = active.list().expect("drenar");
            if current.roots.len() <= 1 {
                assert!(active.release(&current.active_id).is_err());
                break;
            }
            let extra = current
                .roots
                .iter()
                .find(|slot| !slot.active)
                .expect("inactiva");
            let extra_id = extra.id.clone();
            active.release(&extra_id).expect("cerrar extra");
        }
        assert_eq!(active.read_path("a.bara").expect("sigue").source, "uno");

        fs::remove_dir_all(&first).expect("limpiar a");
        fs::remove_dir_all(&second).expect("limpiar b");
    }

    #[test]
    fn dedupe_elimina_pares_solo_por_mayusculas() {
        let mut entries = vec![
            WorkspaceEntry {
                name: "Hello.bara".into(),
                path: "Hello.bara".into(),
                kind: EntryKind::File,
                bara: true,
                children: Vec::new(),
            },
            WorkspaceEntry {
                name: "hELLO.bara".into(),
                path: "hELLO.bara".into(),
                kind: EntryKind::File,
                bara: true,
                children: Vec::new(),
            },
            WorkspaceEntry {
                name: "other.bara".into(),
                path: "other.bara".into(),
                kind: EntryKind::File,
                bara: true,
                children: Vec::new(),
            },
        ];
        dedupe_entries_case_insensitive(&mut entries);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "Hello.bara");
        assert_eq!(entries[1].path, "other.bara");
    }

    #[test]
    fn la_expulsion_del_estante_es_lru() {
        let active = ActiveWorkspace::empty();
        let mut paths = Vec::new();
        for index in 0..ROOT_CAP {
            let dir = scratch(&format!("lru-{index}"));
            let path = resolve_root(dir.to_str().expect("utf-8"))
                .expect("canon")
                .display()
                .to_string();
            assert!(active.set(path.clone()).is_none());
            paths.push((dir, path));
        }
        assert!(active.set(paths[0].1.clone()).is_none());
        let extra_dir = scratch("lru-extra");
        let extra = resolve_root(extra_dir.to_str().expect("utf-8"))
            .expect("canon")
            .display()
            .to_string();
        let evicted = active.set(extra.clone()).expect("la novena expulsa");
        assert_eq!(evicted, paths[1].1);
        let shelf = active.list().expect("estante");
        assert!(shelf.roots.iter().all(|slot| slot.path != paths[1].1));
        assert!(shelf.roots.iter().any(|slot| slot.path == paths[0].1));
        assert!(shelf.roots.iter().any(|slot| slot.path == extra));

        for (dir, _) in paths {
            fs::remove_dir_all(dir).expect("limpiar");
        }
        fs::remove_dir_all(extra_dir).expect("limpiar extra");
    }
}

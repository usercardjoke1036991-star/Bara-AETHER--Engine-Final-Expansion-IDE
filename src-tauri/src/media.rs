//! Cota de inspección multimedia.
//!
//! El diálogo nativo entrega la ruta. Aquí sólo se lee el tamaño: si pasa de
//! 32 MiB el archivo no se abre. Los píxeles no viajan al WebView ni a la red.

#![forbid(unsafe_code)]

use std::fs;
use std::path::Path;

use serde::Serialize;

/// 32 MiB. Ningún archivo multimedia inspeccionado puede superar esta cota.
pub const MAX_MEDIA_BYTES: u64 = 33_554_432;

/// Metadatos de un archivo admitido. No incluye bytes ni ruta absoluta.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInspection {
    /// Nombre del archivo, sin directorios.
    pub name: String,
    /// Tamaño en bytes, siempre `<= `[`MAX_MEDIA_BYTES`].
    pub bytes: u64,
    /// `video` o `image`.
    pub kind: String,
}

/// Inspecciona un archivo local. Rechaza directorios, tipos ajenos y el exceso
/// de tamaño antes de abrir el contenido.
pub fn inspect_media_file(path: &Path) -> Result<MediaInspection, String> {
    let meta = fs::metadata(path)
        .map_err(|err| format!("no se pudo inspeccionar «{}»: {err}", path.display()))?;
    if !meta.is_file() {
        return Err("la selección no es un archivo".to_string());
    }
    if meta.len() > MAX_MEDIA_BYTES {
        return Err(format!(
            "el archivo supera la cota de {MAX_MEDIA_BYTES} bytes"
        ));
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "medio".to_string());
    let kind = media_kind(path)?;
    Ok(MediaInspection {
        name,
        bytes: meta.len(),
        kind,
    })
}

fn media_kind(path: &Path) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "webm" => Ok("video".to_string()),
        "png" | "jpg" | "jpeg" | "gif" | "webp" => Ok("image".to_string()),
        _ => Err("tipo multimedia no admitido".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    fn scratch(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("bara-media-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("directorio");
        path
    }

    #[test]
    fn rechaza_un_archivo_por_encima_de_32_mib_sin_leerlo() {
        let dir = scratch("grande");
        let path = dir.join("clip.mp4");
        let file = File::create(&path).expect("crear");
        file.set_len(MAX_MEDIA_BYTES + 1).expect("tamaño");
        let error = inspect_media_file(&path).expect_err("cota");
        assert!(error.contains("33554432"));
        fs::remove_dir_all(&dir).expect("limpiar");
    }

    #[test]
    fn acepta_un_video_dentro_de_la_cota_y_no_devuelve_pixeles() {
        let dir = scratch("chico");
        let path = dir.join("clip.webm");
        let file = File::create(&path).expect("crear");
        file.set_len(1024).expect("tamaño");
        let inspection = inspect_media_file(&path).expect("admisión");
        assert_eq!(inspection.bytes, 1024);
        assert_eq!(inspection.kind, "video");
        assert_eq!(inspection.name, "clip.webm");
        fs::remove_dir_all(&dir).expect("limpiar");
    }
}

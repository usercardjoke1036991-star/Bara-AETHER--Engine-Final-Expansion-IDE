//! Inferencia local. El GGUF entra por el diálogo del sistema; el prompt no
//! sale de la máquina. La respuesta la arma el núcleo (traducción Shoresh,
//! bilátice y distancia del puente neural), no un runtime con FFI.

#![forbid(unsafe_code)]

use std::fs::File;
use std::io::Read;
use std::path::Path;

use bara::autopoietic::BelnapValue;
use bara::gguf_local::{self, WeightCard};
use bara::neural_bridge::topological_distance;
use bara::syntax;
use bara::topology::AstChart;
use bara::transmute_engine::language_of_extension;
use serde::Serialize;

/// Tope de la cabecera que se lee. El resto del archivo de pesos no entra.
const HEADER_CAP: u64 = 4 * 1024 * 1024;

const MAX_PROMPT: usize = 4_000;

/// Pesos ya aceptados. Vive en el proceso, no en el WebView.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalModel {
    pub name: String,
    pub architecture: String,
    pub context: u32,
    pub tensors: u64,
    pub parameters: u64,
}

/// Ranura del modelo cargado.
#[derive(Debug, Default)]
pub struct LocalSlot {
    card: Option<LocalModel>,
}

impl LocalSlot {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn install(&mut self, model: LocalModel) {
        self.card = Some(model);
    }

    pub fn card(&self) -> Option<&LocalModel> {
        self.card.as_ref()
    }
}

/// Respuesta hermética. `reply` ya viene cerrado por el núcleo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalReply {
    pub name: String,
    pub architecture: String,
    pub glyph: String,
    pub reply: String,
}

/// Tarjeta que el panel puede mostrar tras cargar el archivo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightView {
    pub name: String,
    pub architecture: String,
    pub context: u32,
    pub tensors: u64,
    pub parameters: u64,
}

impl From<&LocalModel> for WeightView {
    fn from(model: &LocalModel) -> Self {
        Self {
            name: model.name.clone(),
            architecture: model.architecture.clone(),
            context: model.context,
            tensors: model.tensors,
            parameters: model.parameters,
        }
    }
}

fn model_of(card: WeightCard) -> LocalModel {
    LocalModel {
        name: card.name,
        architecture: card.architecture,
        context: card.context,
        tensors: card.tensors,
        parameters: card.parameters,
    }
}

/// Abre un `.gguf` local y se queda con la cabecera.
pub fn load_file(path: &Path) -> Result<LocalModel, String> {
    let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    if !ext.eq_ignore_ascii_case("gguf") {
        return Err("el archivo de pesos tiene que ser .gguf".to_string());
    }
    let file = File::open(path).map_err(|_| "no se pudo abrir el GGUF".to_string())?;
    let mut limited = file.take(HEADER_CAP);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|_| "no se pudo leer la cabecera GGUF".to_string())?;
    gguf_local::read_card(&bytes).map(model_of)
}

fn fence(text: &str) -> Option<String> {
    let mut inside = false;
    let mut body = String::new();
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            if inside {
                return Some(body);
            }
            inside = true;
            continue;
        }
        if inside {
            body.push_str(line);
            body.push('\n');
        }
    }
    None
}

fn language_of_prompt(text: &str) -> bara::transmuter::SourceLanguage {
    let head = text
        .lines()
        .find(|line| line.trim_start().starts_with("```"));
    let lang = head
        .and_then(|line| {
            line.trim_start()
                .trim_start_matches('`')
                .split_whitespace()
                .next()
        })
        .unwrap_or("");
    language_of_extension(lang)
}

/// Resuelve el prompt con el modelo ya cargado. No abre sockets.
pub fn complete(model: &LocalModel, prompt: &str) -> LocalReply {
    let prompt = prompt.chars().take(MAX_PROMPT).collect::<String>();
    let translation = bara_ide::translate(&prompt);
    let code = fence(&prompt).unwrap_or_default();
    let value = if code.trim().is_empty() {
        BelnapValue::Neither
    } else {
        syntax::judge_patch(language_of_prompt(&prompt), "", &code)
    };
    let focus = AstChart::from_roots(&[model.architecture.as_str()]);
    let root = translation
        .roots
        .first()
        .map(String::as_str)
        .unwrap_or("ברא");
    let other = AstChart::from_roots(&[root]);
    let distance = match (focus.points().first(), other.points().first()) {
        (Some(left), Some(right)) => topological_distance(left, right),
        _ => 0,
    };
    let program = translation.program.chars().take(500).collect::<String>();
    let roots = if translation.roots.is_empty() {
        "sin raíces".to_string()
    } else {
        translation.roots.join(" ")
    };
    let reply = format!(
        "modelo {} · {} · contexto {} · {} tensores · {} parámetros · sin red\n{}\n{} {}\ndistancia topológica {}\nraíces: {}\n{}",
        model.name,
        model.architecture,
        model.context,
        model.tensors,
        model.parameters,
        "la cabecera identifica el modelo; los tensores no se ejecutan",
        value.glyph(),
        value.name(),
        distance,
        roots,
        program
    );
    LocalReply {
        name: model.name.clone(),
        architecture: model.architecture.clone(),
        glyph: value.glyph().to_string(),
        reply,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card() -> LocalModel {
        LocalModel {
            name: "bara-local".to_string(),
            architecture: "neura".to_string(),
            context: 2048,
            tensors: 1,
            parameters: 32,
        }
    }

    #[test]
    fn la_respuesta_nombra_el_modelo_y_no_sale_de_la_maquina() {
        let reply = complete(&card(), "crea una guarda");
        assert!(reply.reply.contains("bara-local"));
        assert!(reply.reply.contains("sin red"));
        assert!(!reply.reply.contains("https://"));
        let fenced = complete(&card(), "```rs\nfn nueva() {}\n```");
        assert_eq!(fenced.glyph, "∅");
        let broken = complete(&card(), "```rs\nfn nueva() {\n```");
        assert_eq!(broken.glyph, "⊤∧⊥");
    }

    #[test]
    fn el_modulo_no_abre_la_red() {
        let source = include_str!("local_infer.rs");
        let production = source.split("mod tests").next().unwrap_or(source);
        assert!(!production.contains("TcpStream"));
        assert!(!production.contains("https://"));
        assert!(!production.contains("Command::new"));
    }
}

//! # bara-ide — Núcleo de análisis del IDE Bara (AETHER‑Ω)
//!
//! *Front-end de análisis* del kernel: no reimplementa nada. Envuelve el lexer
//! *Shoresh* de `bara` —enlazado por ruta a `../BAR`— **sobre los tipos del
//! propio núcleo** y compone un modelo de documento con dos consumidores:
//!
//! * la **CLI** (`src/main.rs`), que lo imprime en texto plano;
//! * el **backend de escritorio** (`src-tauri/`, Tauri v2), que lo serializa a
//!   JSON para la interfaz React + TypeScript (`web/`).
//!
//! Además proyecta dos servicios del núcleo sin duplicar sus literales: el
//! catálogo de raíces ([`catalogue`]) y el traductor de lengua natural a
//! *Shoresh* ([`translate`], el mismo léxico que usa el oráculo del REPL).
//!
//! ## Invariantes
//! 1. **Cero dependencias por defecto** — igual que el kernel, compilar esta
//!    biblioteca (y por tanto la CLI) no arrastra *crates* externos. `serde` es
//!    una *feature* opcional (`serde`) que sólo activa el backend de escritorio
//!    para derivar `Serialize` sobre el modelo.
//! 2. **Totalidad heredada** — `Lexer::tokenize` es infalible y [`analyze`]
//!    tampoco puede fallar: siempre devuelve un documento.
//! 3. **Sin `unsafe`**.

#![forbid(unsafe_code)]

use std::fmt::Write as _;

use bara::repl::{Oracle, OracleTurn};
use bara::runtime::{BaraRuntime, Observation, QuantumState};
use bara::temporal_rollback::Marker;

// Tipos del kernel, reexportados tal cual: el IDE trabaja *sobre* el núcleo,
// nunca sobre una copia de sus tipos.
pub use bara::lexer::{Keyword, Lexer, Token, TokenKind};

// Paneles de la fase AETHER‑Ω: proyecciones del kernel (autopoiesis + ZK,
// banco cuántico, malla, Metal‑IR y geometría áurea de la memoria).
pub mod aether;

pub use aether::{
    autopoiesis, fractal_memory, fractal_plan, mesh_status, metal_program, quantum_register,
    timeline, AmplitudeView, AutopoiesisReport, AxiomView, BellView, BindingView, FractalCellView,
    FractalMemoryView, MeshNodeView, MeshView, MetalOpView, MetalView, ParadoxView, QuantumView,
    QubitView, RegisterView, TimelineDeltaView, TimelineView, ZkCheckView, ZkGateView,
};

/// Versión de este *front-end* (la del paquete `bara-ide`).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Documento *Shoresh* de ejemplo (`samples/genesis.bara`), embebido en tiempo
/// de compilación: el escritorio lo sirve sin depender del directorio actual.
pub const SAMPLE_GENESIS: &str = include_str!("../samples/genesis.bara");

/// Clase léxica de un token, en la etiqueta estable que consume la interfaz.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub enum TokenClass {
    /// Raíz triconsonántica reconocida por el kernel.
    RootKnown,
    /// Raíz triconsonántica desconocida (el runtime la sintetiza: autopoiesis).
    RootUnknown,
    /// Identificador ASCII (p. ej. etiqueta de memoria).
    Identifier,
    /// Literal numérico.
    Number,
    /// Literal de cadena.
    Str,
    /// Salto de línea.
    Newline,
    /// Centinela de fin de entrada.
    Eof,
    /// Signo de puntuación u operador paraconsistente.
    Punctuation,
}

impl TokenClass {
    /// Etiqueta corta para tablas (CLI y UI).
    pub fn label(self) -> &'static str {
        match self {
            TokenClass::RootKnown => "raiz",
            TokenClass::RootUnknown => "raiz?",
            TokenClass::Identifier => "ident",
            TokenClass::Number => "num",
            TokenClass::Str => "cadena",
            TokenClass::Newline => "nl",
            TokenClass::Eof => "eof",
            TokenClass::Punctuation => "signo",
        }
    }
}

/// Un token del documento con su posición y sus dos representaciones.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct TokenInfo {
    /// Línea (1-based).
    pub line: usize,
    /// Columna (1-based).
    pub column: usize,
    /// Clase léxica.
    pub class: TokenClass,
    /// Lexema canónico (raíz, identificador, contenido del literal…): lo que
    /// pinta la interfaz.
    pub lexeme: String,
    /// Representación textual del kernel (`TokenKind`), la que imprime la CLI.
    pub display: String,
    /// Glifo hebreo de la raíz, si el kernel la reconoce.
    pub glyph: Option<&'static str>,
    /// Descripción ontológica de la raíz, si el kernel la reconoce.
    pub meaning: Option<&'static str>,
}

/// Recuento de tokens por clase léxica del kernel.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Summary {
    /// Tokens totales (incluye saltos de línea y el centinela de fin).
    pub total: usize,
    /// Raíces reconocidas.
    pub roots_known: usize,
    /// Raíces desconocidas (sintetizadas por el runtime).
    pub roots_unknown: usize,
    /// Identificadores.
    pub identifiers: usize,
    /// Literales numéricos.
    pub numbers: usize,
    /// Literales de cadena.
    pub strings: usize,
    /// Signos y operadores.
    pub punctuation: usize,
    /// Saltos de línea.
    pub newlines: usize,
    /// Centinelas de fin de entrada.
    pub eof: usize,
}

/// Uso de una raíz reconocida dentro del documento (panel *outline* del IDE).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct RootUsage {
    /// Glifo hebreo de la raíz.
    pub glyph: &'static str,
    /// Descripción ontológica de la instrucción.
    pub meaning: &'static str,
    /// Número de apariciones en el documento.
    pub count: usize,
}

/// Entrada del catálogo de raíces conocidas (sin recuento de apariciones).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct RootEntry {
    /// Glifo hebreo de la raíz.
    pub glyph: &'static str,
    /// Descripción ontológica de la instrucción.
    pub meaning: &'static str,
}

/// Documento *Shoresh* analizado por el kernel.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Analysis {
    /// Caracteres Unicode de la fuente.
    pub source_chars: usize,
    /// Líneas de la fuente.
    pub source_lines: usize,
    /// Tokens en orden de aparición.
    pub tokens: Vec<TokenInfo>,
    /// Recuento por clase léxica.
    pub summary: Summary,
    /// Inventario de raíces reconocidas, en orden de aparición.
    pub roots: Vec<RootUsage>,
}

/// Modo de informe de texto de la CLI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportMode {
    /// Tabla de tokens con línea y columna, más el resumen.
    Tokens,
    /// Sólo el resumen y el inventario de raíces.
    Summary,
}

/// Analiza una fuente *Shoresh* con el lexer del kernel.
///
/// **No puede fallar**: igual que el lexer del núcleo, degrada lo que no
/// comprende en lugar de abortar.
pub fn analyze(source: &str) -> Analysis {
    let tokens = Lexer::new(source).tokenize();
    Analysis {
        source_chars: source.chars().count(),
        source_lines: source.lines().count(),
        summary: summarize(&tokens),
        roots: inventory(&tokens),
        tokens: tokens.iter().map(describe).collect(),
    }
}

/// Clase léxica de un token del kernel.
///
/// El `match` es exhaustivo **a propósito**: si el kernel añade una clase
/// léxica nueva, este *front-end* deja de compilar y obliga a decidir
/// explícitamente cómo se representa en el IDE.
fn token_class(token: &Token) -> TokenClass {
    match &token.kind {
        TokenKind::Root { keyword, .. } => match keyword {
            Some(_) => TokenClass::RootKnown,
            None => TokenClass::RootUnknown,
        },
        TokenKind::Identifier(_) => TokenClass::Identifier,
        TokenKind::Number(_) => TokenClass::Number,
        TokenKind::Str(_) => TokenClass::Str,
        TokenKind::Colon
        | TokenKind::Semicolon
        | TokenKind::Comma
        | TokenKind::Arrow
        | TokenKind::Plus
        | TokenKind::Star
        | TokenKind::Bang
        | TokenKind::BangBang
        | TokenKind::Question
        | TokenKind::Punct(_) => TokenClass::Punctuation,
        TokenKind::Newline => TokenClass::Newline,
        TokenKind::Eof => TokenClass::Eof,
    }
}

/// Lexema canónico de un token: lo que muestra la interfaz.
fn lexeme(token: &Token) -> String {
    match &token.kind {
        TokenKind::Root { letters, .. } => letters.clone(),
        TokenKind::Identifier(name) => name.clone(),
        TokenKind::Number(value) => value.to_string(),
        TokenKind::Str(text) => text.clone(),
        TokenKind::Colon => ":".to_string(),
        TokenKind::Semicolon => ";".to_string(),
        TokenKind::Comma => ",".to_string(),
        TokenKind::Arrow => "->".to_string(),
        TokenKind::Plus => "+".to_string(),
        TokenKind::Star => "*".to_string(),
        TokenKind::Bang => "!".to_string(),
        TokenKind::BangBang => "!!".to_string(),
        TokenKind::Question => "?".to_string(),
        TokenKind::Punct(c) => c.to_string(),
        TokenKind::Newline => "\n".to_string(),
        TokenKind::Eof => String::new(),
    }
}

/// Proyecta un token del kernel al modelo del IDE.
fn describe(token: &Token) -> TokenInfo {
    let keyword = token.keyword();
    TokenInfo {
        line: token.line,
        column: token.column,
        class: token_class(token),
        lexeme: lexeme(token),
        display: token.kind.to_string(),
        glyph: keyword.map(|known| known.glyph()),
        meaning: keyword.map(|known| known.meaning()),
    }
}

/// Recuento por clase léxica.
fn summarize(tokens: &[Token]) -> Summary {
    let mut summary = Summary::default();
    for token in tokens {
        summary.total += 1;
        match token_class(token) {
            TokenClass::RootKnown => summary.roots_known += 1,
            TokenClass::RootUnknown => summary.roots_unknown += 1,
            TokenClass::Identifier => summary.identifiers += 1,
            TokenClass::Number => summary.numbers += 1,
            TokenClass::Str => summary.strings += 1,
            TokenClass::Punctuation => summary.punctuation += 1,
            TokenClass::Newline => summary.newlines += 1,
            TokenClass::Eof => summary.eof += 1,
        }
    }
    summary
}

/// Inventario de raíces reconocidas, en orden de aparición: el *outline* que el
/// IDE ofrece sobre el documento abierto.
fn inventory(tokens: &[Token]) -> Vec<RootUsage> {
    let mut found: Vec<RootUsage> = Vec::new();
    for token in tokens {
        if let Some(keyword) = token.keyword() {
            match found
                .iter_mut()
                .find(|entry| entry.glyph == keyword.glyph())
            {
                Some(entry) => entry.count += 1,
                None => found.push(RootUsage {
                    glyph: keyword.glyph(),
                    meaning: keyword.meaning(),
                    count: 1,
                }),
            }
        }
    }
    found
}

/// Las seis raíces semánticas que el kernel reconoce de fábrica, en el orden en
/// que su enumerado las declara.
pub const KEYWORDS: [Keyword; 6] = [
    Keyword::Manifest,
    Keyword::Guard,
    Keyword::Synthesize,
    Keyword::Execute,
    Keyword::Emit,
    Keyword::Judge,
];

/// Catálogo (glifo + significado) de las raíces conocidas, **tomado del
/// kernel**: la interfaz no duplica ni un literal.
pub fn catalogue() -> Vec<RootEntry> {
    KEYWORDS
        .iter()
        .map(|keyword| RootEntry {
            glyph: keyword.glyph(),
            meaning: keyword.meaning(),
        })
        .collect()
}

/// Programa *Shoresh* destilado por el léxico del kernel a partir de lengua
/// natural (el mismo traductor que gobierna al oráculo del REPL).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct Translation {
    /// Raíces triconsonánticas listas para compilar (vacío si no hay nada).
    pub program: String,
    /// Raíces y operadores usados, en orden de aparición.
    pub roots: Vec<String>,
    /// Raíces que el léxico desconocía y el oráculo sintetizó (autopoiesis).
    pub synthesized: usize,
}

/// Traduce lengua natural a un programa *Shoresh* con el **léxico del kernel**
/// (`bara::repl::natural_to_roots`): la interfaz no duplica ni una entrada del
/// diccionario.
///
/// La traducción es total, igual que el resto del núcleo: un verbo desconocido
/// no es un error, se convierte en una raíz nueva por autopoiesis. El panel de
/// IA la usa para mostrar el programa canónico que el propio kernel compilaría.
pub fn translate(text: &str) -> Translation {
    let (program, roots, synthesized) = bara::repl::natural_to_roots(text);
    Translation {
        program: program.trim().to_string(),
        roots,
        synthesized,
    }
}

/// Lee un documento `.bara` del disco, con error legible para la interfaz.
pub fn read_source_file(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|err| format!("no se pudo leer «{path}»: {err}"))
}

/// Renderiza el informe de texto de la CLI sobre un documento analizado.
///
/// El texto es **idéntico** al que la CLI imprimía antes de existir esta
/// biblioteca: la CLI sólo aporta el origen (`<stdin>` o la ruta) y el modo.
pub fn render_report(analysis: &Analysis, origin: &str, mode: ReportMode) -> String {
    let summary = &analysis.summary;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "bara-ide {VERSION} - {origin} - {} tokens analizados por el kernel",
        summary.total
    );

    if let ReportMode::Tokens = mode {
        for token in &analysis.tokens {
            let _ = writeln!(
                out,
                "  {:>4}:{:<3} {}",
                token.line, token.column, token.display
            );
        }
        let _ = writeln!(out);
    }

    let _ = writeln!(out, "clases lexicas");
    let _ = writeln!(out, "   raices conocidas   : {}", summary.roots_known);
    let _ = writeln!(out, "   raices desconocidas: {}", summary.roots_unknown);
    let _ = writeln!(out, "   identificadores    : {}", summary.identifiers);
    let _ = writeln!(out, "   numeros            : {}", summary.numbers);
    let _ = writeln!(out, "   cadenas            : {}", summary.strings);
    let _ = writeln!(out, "   simbolos           : {}", summary.punctuation);
    let _ = writeln!(out, "   saltos de linea    : {}", summary.newlines);
    let _ = writeln!(out, "   centinelas EOF     : {}", summary.eof);

    let _ = writeln!(out);
    let _ = writeln!(out, "inventario de raices reconocidas (orden de aparicion)");
    if analysis.roots.is_empty() {
        let _ = writeln!(out, "   (ninguna)");
    } else {
        for root in &analysis.roots {
            let _ = writeln!(
                out,
                "   {}  {:<34} x{}",
                root.glyph, root.meaning, root.count
            );
        }
    }

    out
}

// ─────────────────────────────────────────────────────────────────────────
// Biláttice de Belnap: el núcleo es paraconsistente y la interfaz lo muestra
// ─────────────────────────────────────────────────────────────────────────
//
// Nada de esto reimplementa lógica: cada punto se **proyecta** desde
// `bara::runtime::QuantumState` (masas recortadas por el kernel, clasificación
// con **su** umbral de designación y **sus** literales `⊤ ⊥ ⊤∧⊥ ∅`).

/// Observación discreta del kernel para un estado (enum `Observation`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ObservationView {
    /// Símbolo lógico canónico (`⊤`, `⊥`, `⊤∧⊥`, `∅`).
    pub glyph: &'static str,
    /// Nombre ontológico del kernel.
    pub name: &'static str,
}

impl ObservationView {
    /// Proyecta una observación tal cual la clasifica el núcleo.
    fn project(observation: Observation) -> Self {
        ObservationView {
            glyph: observation.glyph(),
            name: observation.name(),
        }
    }
}

/// Un estado proyectado a la biláttice de Belnap `(⊤, ⊥)`.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct BelnapPoint {
    /// Clave estable para la interfaz (`true`, `false`, `both`, `neither`),
    /// derivada de la clasificación del kernel —no de esta capa—.
    pub key: &'static str,
    /// Masa de verdad en `[0,1]`, ya recortada por el kernel.
    pub truth: f64,
    /// Masa de falsedad en `[0,1]`, ya recortada por el kernel.
    pub falsity: f64,
    /// Observación discreta del núcleo.
    pub observation: ObservationView,
    /// ¿Es `⊤∧⊥`? La contradicción se retiene, jamás explota.
    pub contradiction: bool,
    /// ¿Es verdadero designado (`⊤`) con el umbral del kernel?
    pub designated: bool,
}

impl BelnapPoint {
    /// Proyecta un estado del kernel: aquí no se toma ninguna decisión lógica.
    fn project(state: &QuantumState) -> Self {
        let (truth, falsity) = state.belnap();
        let observation = state.observe();
        BelnapPoint {
            key: key_of(observation),
            truth,
            falsity,
            observation: ObservationView::project(observation),
            contradiction: state.is_contradiction(),
            designated: observation == Observation::True,
        }
    }
}

/// Clave estable de una observación: las cuatro valencias de `FOUR`.
fn key_of(observation: Observation) -> &'static str {
    match observation {
        Observation::True => "true",
        Observation::False => "false",
        Observation::Both => "both",
        Observation::Neither => "neither",
    }
}

/// Las cuatro esquinas de la biláttice `FOUR`, como pares `(⊤, ⊥)`.
const BILATTICE_CORNERS: [(f64, f64); 4] = [(1.0, 0.0), (0.0, 1.0), (1.0, 1.0), (0.0, 0.0)];

/// Esquinas de `FOUR` como estados paraconsistentes del propio kernel.
fn corner_states() -> Vec<QuantumState> {
    BILATTICE_CORNERS
        .iter()
        .map(|(truth, falsity)| QuantumState::paraconsistent(*truth, *falsity))
        .collect()
}

/// Las cuatro valencias canónicas de `FOUR`, clasificadas por el kernel.
pub fn belnap_values() -> Vec<BelnapPoint> {
    corner_states().iter().map(BelnapPoint::project).collect()
}

/// Tablas de la biláttice de Belnap **calculadas por el kernel**.
///
/// `conjunction` es el *meet* (`∧`), `disjunction` el *join* (`∨`) y
/// `negation` la negación paraconsistente: los computa
/// `bara::runtime::QuantumState`, de modo que la interfaz enseña la álgebra
/// real del núcleo y no una copia suya.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct BelnapLattice {
    /// Las cuatro valencias canónicas (`⊤`, `⊥`, `⊤∧⊥`, `∅`), en ese orden.
    pub values: Vec<BelnapPoint>,
    /// Tabla `∧` (*meet*) de 4×4, indexada por [`BelnapLattice::values`].
    pub conjunction: Vec<Vec<BelnapPoint>>,
    /// Tabla `∨` (*join*) de 4×4, indexada por [`BelnapLattice::values`].
    pub disjunction: Vec<Vec<BelnapPoint>>,
    /// Negación paraconsistente de cada valencia canónica.
    pub negation: Vec<BelnapPoint>,
}

/// Biláttice de Belnap completa, computada por el kernel.
pub fn belnap_lattice() -> BelnapLattice {
    let states = corner_states();
    let conjunction = states
        .iter()
        .map(|left| {
            states
                .iter()
                .map(|right| BelnapPoint::project(&left.conjunction(right)))
                .collect()
        })
        .collect();
    let disjunction = states
        .iter()
        .map(|left| {
            states
                .iter()
                .map(|right| BelnapPoint::project(&left.disjunction(right)))
                .collect()
        })
        .collect();
    let negation = states
        .iter()
        .map(|state| BelnapPoint::project(&state.negate()))
        .collect();
    BelnapLattice {
        values: belnap_values(),
        conjunction,
        disjunction,
        negation,
    }
}

/// Evaluación de un par `(⊤, ⊥)` arbitrario y de su negación.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct BelnapEvaluation {
    /// Punto evaluado, con las masas ya recortadas por el kernel.
    pub point: BelnapPoint,
    /// Negación paraconsistente del punto (las masas intercambiadas).
    pub negation: BelnapPoint,
}

/// Evalúa un par de masas con la lógica del núcleo.
///
/// **Total**: cualquier entrada —fuera de rango incluida— la recorta y la
/// clasifica `QuantumState`; aquí no hay ruta de error ni de aborto (A1).
pub fn belnap_evaluate(truth: f64, falsity: f64) -> BelnapEvaluation {
    let state = QuantumState::paraconsistent(truth, falsity);
    BelnapEvaluation {
        point: BelnapPoint::project(&state),
        negation: BelnapPoint::project(&state.negate()),
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Oráculo y control temporal (`Δ⁻¹`): sesión determinista sin terminal
// ─────────────────────────────────────────────────────────────────────────
//
// La sesión guarda su **guion** (las consultas, en orden) y los marcadores
// rebobinados. Cada operación lo reproduce en un runtime nuevo con el oráculo
// del kernel (`Oracle::converse` → lexer → runtime → proyecciones) y vuelve a
// aplicar los `Δ⁻¹`; el resultado es idéntico al de una conversación en vivo
// porque nada depende del reloj salvo los campos `micros`, marcados
// **NO DETERMINISTAS** (invariante A7 del núcleo).

/// Un turno del oráculo proyectado (struct `OracleTurn` del kernel).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct TurnView {
    /// Consulta original.
    pub input: String,
    /// Intención interpretada (`shoresh`, comando meta o silencio).
    pub intent: String,
    /// Programa *Shoresh* compilado al vuelo.
    pub roots: String,
    /// Respuesta del oráculo.
    pub reply: String,
    /// Eventos ontológicos emitidos.
    pub events: usize,
    /// Axiomas nacidos por autopoiesis durante el turno.
    pub axioms: usize,
    /// Estado del monitor `Δ⁻¹`.
    pub monitor: String,
    /// Duración de la compilación dinámica, en microsegundos.
    ///
    /// **NO DETERMINISTA** (matiz de A7): métrica de reloj de pared.
    pub micros: u64,
}

impl TurnView {
    /// Proyecta un turno del kernel (el reloj se satura a `u64`).
    fn project(turn: &OracleTurn) -> Self {
        TurnView {
            input: turn.input.clone(),
            intent: turn.intent.clone(),
            roots: turn.roots.clone(),
            reply: turn.reply.clone(),
            events: turn.events,
            axioms: turn.axioms,
            monitor: turn.monitor.clone(),
            micros: saturate(turn.micros),
        }
    }
}

/// Un paso del diario temporal `Δ⁻¹` (struct `Delta` del kernel).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct DeltaView {
    /// Identificador monótono.
    pub id: u64,
    /// Etiqueta descriptiva de la operación.
    pub label: String,
    /// Operador inverso que lo deshace (`Δ⁻¹` ⇒ …), según el kernel.
    pub inverse: &'static str,
    /// ¿Ya fue revertido por un `Δ⁻¹`?
    pub reverted: bool,
    /// Instante del diario, en microsegundos.
    ///
    /// **NO DETERMINISTA** (matiz de A7): reloj de pared.
    pub at_micros: u64,
}

impl DeltaView {
    /// Proyecta un delta del kernel.
    fn project(delta: &bara::temporal_rollback::Delta) -> Self {
        DeltaView {
            id: delta.id,
            label: delta.label.clone(),
            inverse: delta.inv_label(),
            reverted: delta.reverted,
            at_micros: saturate(delta.at_micros),
        }
    }
}

/// Informe de un rebobinado `Δ⁻¹` (struct `RollbackReport` del kernel).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct RollbackView {
    /// Marcador al que se rebobinó.
    pub marker: u64,
    /// Número de deltas revertidos.
    pub reverted: usize,
    /// Duración del rebobinado, en microsegundos.
    ///
    /// **NO DETERMINISTA** (matiz de A7): reloj de pared.
    pub micros: u64,
    /// Paradoja que lo motivó, si la hubo.
    pub paradox: Option<String>,
}

impl RollbackView {
    /// Proyecta un informe de rebobinado del kernel.
    fn project(marker: u64, report: &bara::temporal_rollback::RollbackReport) -> Self {
        RollbackView {
            marker,
            reverted: report.reverted,
            micros: saturate(report.micros),
            paradox: report.paradox.clone(),
        }
    }
}

/// Satura las métricas de reloj del kernel a `u64` (total, sin aborto).
fn saturate(micros: u128) -> u64 {
    micros.min(u128::from(u64::MAX)) as u64
}

/// Estado de la sesión del oráculo con el control temporal aplicado.
///
/// Todo lo que publica lo ha medido el kernel: el informe del oráculo, la
/// pila de estados, el diario `Δ⁻¹`, la memoria holográfica, el mutador
/// autopoiético y la malla.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct SessionStatus {
    /// Turnos conversados en la sesión.
    pub turns: usize,
    /// Eventos ontológicos acumulados.
    pub events: usize,
    /// Pulsos de rollback `Δ⁻¹` registrados en el log.
    pub rollbacks: usize,
    /// Axiomas sintetizados por autopoiesis.
    pub synthesized: usize,
    /// Raíces tocadas durante la sesión.
    pub roots: Vec<String>,
    /// Tiempo total de compilación dinámica, en microsegundos.
    ///
    /// **NO DETERMINISTA** (matiz de A7): suma de relojes de pared.
    pub micros: u64,
    /// Marcadores rebobinados, en orden de solicitud.
    pub applied_rollbacks: Vec<u64>,
    /// Altura de la pila del evaluador.
    pub stack_depth: usize,
    /// Altura de la pila de estados reversible del motor temporal.
    pub timeline_depth: usize,
    /// Etiqueta del estado temporal en la cima, si la hay.
    pub timeline_top: Option<String>,
    /// Observación de Belnap de ese estado, si lo hay.
    pub timeline_observation: Option<ObservationView>,
    /// ¿La cima es `⊤∧⊥` (contradicción tolerada)?
    pub timeline_contradiction: bool,
    /// Deltas registrados en el diario (incluidos los revertidos).
    pub deltas: usize,
    /// Deltas ya revertidos por un `Δ⁻¹`.
    pub reverted: usize,
    /// Marcador del instante actual: el que se pasa a un rebobinado.
    pub next_marker: u64,
    /// Nodos de memoria holográfica.
    pub memory_nodes: usize,
    /// Entropía de la memoria (0 ⇒ idempotente).
    pub entropy: f64,
    /// Regiones de memoria inferidas.
    pub regions: usize,
    /// Axiomas conocidos por el mutador.
    pub axioms: usize,
    /// Generación evolutiva del lenguaje.
    pub generation: usize,
    /// Qubits nativos registrados.
    pub qubits: usize,
    /// Peers de la malla holográfica.
    pub mesh_peers: usize,
    /// Respuesta del último turno, para la consola del IDE.
    pub last_reply: Option<String>,
}

/// Resultado de una operación de sesión (turno, rebobinados y estado).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct TurnResult {
    /// Turno recién conversado (`None` si la operación fue un rebobinado).
    pub turn: Option<TurnView>,
    /// Rebobinados `Δ⁻¹` aplicados, en orden.
    pub rollbacks: Vec<RollbackView>,
    /// Estado de la sesión tras la operación.
    pub status: SessionStatus,
}

/// Sesión reproducida: lo que devuelve [`Session::replay`].
struct Replayed {
    /// Turnos conversados, en orden.
    turns: Vec<TurnView>,
    /// Rebobinados aplicados, en orden.
    rollbacks: Vec<RollbackView>,
    /// Diario temporal completo del runtime reproducido.
    deltas: Vec<DeltaView>,
    /// Estado derivado de todo lo anterior.
    status: SessionStatus,
}

/// Sesión del oráculo con control temporal `Δ⁻¹`, sin terminal y total.
///
/// El estado de la sesión es su guion más los marcadores rebobinados: se
/// reproduce hacia adelante con el oráculo del kernel cada vez que se consulta,
/// de modo que una sesión es **determinista** (salvo los campos `micros`) y no
/// guarda ningún préstamo del runtime: ni `unsafe` ni auto-referencias.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Session {
    /// Consultas conversadas, en orden.
    script: Vec<String>,
    /// Marcadores rebobinados con `Δ⁻¹`, en orden de solicitud.
    rollbacks: Vec<u64>,
}

impl Session {
    /// Crea una sesión virgen.
    pub fn new() -> Self {
        Session::default()
    }

    /// Guion de la sesión: las consultas conversadas, en orden.
    pub fn script(&self) -> &[String] {
        &self.script
    }

    /// Marcadores rebobinados con `Δ⁻¹`, en orden de solicitud.
    pub fn applied_rollbacks(&self) -> &[u64] {
        &self.rollbacks
    }

    /// ¿La sesión está virgen (sin consultas ni rebobinados)?
    pub fn is_empty(&self) -> bool {
        self.script.is_empty() && self.rollbacks.is_empty()
    }

    /// Cierra la sesión: se descartan guion y rebobinados.
    pub fn reset(&mut self) {
        self.script.clear();
        self.rollbacks.clear();
    }

    /// Conversa un turno con el oráculo del kernel y devuelve el estado.
    pub fn converse(&mut self, input: &str) -> TurnResult {
        self.script.push(input.to_string());
        self.snapshot()
    }

    /// Añade un rebobinado `Δ⁻¹` hasta `marker` y devuelve el estado.
    ///
    /// Repetir un marcador ya rebobinado no reintroduce nada: el motor del
    /// kernel sólo revierte los deltas **vivos**, así que el `Δ⁻¹` es
    /// idempotente.
    pub fn rollback(&mut self, marker: u64) -> TurnResult {
        self.rollbacks.push(marker);
        self.snapshot()
    }

    /// Estado actual de la sesión.
    pub fn status(&self) -> SessionStatus {
        self.replay().status
    }

    /// Turnos conversados, en orden.
    pub fn turns(&self) -> Vec<TurnView> {
        self.replay().turns
    }

    /// Diario temporal `Δ⁻¹` completo (incluye los deltas revertidos).
    pub fn deltas(&self) -> Vec<DeltaView> {
        self.replay().deltas
    }

    /// Reproduce la sesión y devuelve el turno recién conversado.
    fn snapshot(&self) -> TurnResult {
        let replayed = self.replay();
        TurnResult {
            turn: replayed.turns.last().cloned(),
            rollbacks: replayed.rollbacks,
            status: replayed.status,
        }
    }
}

impl Session {
    /// Reproduce el guion con el oráculo del kernel y aplica los `Δ⁻¹`.
    ///
    /// Se usa `Oracle::converse` —y **no** el bucle de terminal del núcleo—
    /// para no escribir en la salida estándar: el pipeline es exactamente el
    /// mismo (intérprete, lexer y runtime del kernel) y por eso los comandos
    /// meta (`:estado`, `:deshacer`, …) se comportan igual que en el REPL.
    fn replay(&self) -> Replayed {
        let mut runtime = BaraRuntime::new();
        let mut turns: Vec<TurnView> = Vec::new();
        let (events, pulse, synthesized, micros, roots) = {
            let mut oracle = Oracle::new(&mut runtime);
            for input in &self.script {
                // `converse` registra siempre el turno; si alguna vez no lo
                // hiciera, la sesión degrada sin abortar (A1 · totalidad).
                if let Some(turn) = oracle.converse(input) {
                    turns.push(TurnView::project(turn));
                }
            }
            let report = oracle.report();
            (
                report.events,
                report.rollbacks,
                report.synthesized,
                report.micros,
                report.roots,
            )
        };

        // El `Δ⁻¹` se pide al motor temporal del kernel, en el orden en que la
        // interfaz los solicitó: el estado temporal se reproduce igual.
        let mut rollbacks: Vec<RollbackView> = Vec::new();
        for marker in &self.rollbacks {
            let report = runtime.timeline.rollback_to(Marker(*marker));
            rollbacks.push(RollbackView::project(*marker, &report));
        }

        let deltas: Vec<DeltaView> = runtime
            .timeline
            .deltas()
            .iter()
            .map(DeltaView::project)
            .collect();
        let timeline = &runtime.timeline;
        let top = timeline.stack().last();
        let status = SessionStatus {
            turns: turns.len(),
            events,
            rollbacks: pulse,
            synthesized,
            roots,
            micros: saturate(micros),
            applied_rollbacks: self.rollbacks.clone(),
            stack_depth: runtime.stack.len(),
            timeline_depth: timeline.stack().len(),
            timeline_top: top.map(QuantumState::label),
            timeline_observation: top.map(|state| ObservationView::project(state.observe())),
            timeline_contradiction: top.map(QuantumState::is_contradiction).unwrap_or(false),
            deltas: deltas.len(),
            reverted: deltas.iter().filter(|delta| delta.reverted).count(),
            next_marker: timeline.mark().0,
            memory_nodes: runtime.memory.len(),
            entropy: runtime.memory.entropy(),
            regions: runtime.regions.len(),
            axioms: runtime.mutator.axioms().count(),
            generation: runtime.mutator.generation(),
            qubits: runtime.qubits.len(),
            mesh_peers: runtime.mesh.len(),
            last_reply: turns.last().map(|turn| turn.reply.clone()),
        };

        Replayed {
            turns,
            rollbacks,
            deltas,
            status,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Contrato IPC del oráculo, Belnap y el control temporal: el JSON que
    /// devuelve el backend usa exactamente las claves de `web/src/engine.ts`.
    #[cfg(feature = "serde")]
    #[test]
    fn el_oraculo_y_la_bilattice_serializan_con_el_contrato_de_la_interfaz() {
        let result = Session::new().converse("guarda");
        let json = serde_json::to_value(&result).expect("la sesion debe serializar");
        assert_eq!(json["turn"]["roots"], "שמר");
        assert!(json["turn"]["intent"].is_string());
        assert!(json["turn"]["micros"].is_number());
        assert_eq!(json["status"]["turns"], 1);
        assert_eq!(json["status"]["appliedRollbacks"], serde_json::json!([]));
        assert!(json["status"]["nextMarker"].is_number());
        assert!(json["status"]["lastReply"].is_string());
        assert!(
            json["status"]["timelineObservation"].is_null()
                || json["status"]["timelineObservation"]["glyph"].is_string()
        );
        assert!(json["rollbacks"].is_array());

        let lattice = serde_json::to_value(belnap_lattice()).expect("la bilattice debe serializar");
        assert_eq!(lattice["values"].as_array().map(Vec::len), Some(4));
        assert_eq!(lattice["values"][0]["key"], "true");
        assert_eq!(lattice["values"][3]["key"], "neither");
        assert_eq!(lattice["conjunction"][0][0]["key"], "true");
        assert_eq!(lattice["disjunction"][0][1]["key"], "true");
        assert_eq!(lattice["negation"][0]["key"], "false");
        assert_eq!(lattice["values"][2]["observation"]["glyph"], "⊤∧⊥");
        assert_eq!(
            lattice["values"][2]["observation"]["name"],
            "contradicción tolerada"
        );
        assert_eq!(lattice["values"][3]["observation"]["glyph"], "∅");
        assert_eq!(lattice["values"][0]["designated"], true);
        assert_eq!(lattice["values"][2]["designated"], false);

        let evaluation = serde_json::to_value(belnap_evaluate(1.0, 1.0)).expect("evalua");
        assert_eq!(evaluation["point"]["key"], "both");
        assert_eq!(evaluation["point"]["contradiction"], true);
        assert_eq!(evaluation["point"]["truth"], 1.0);
        assert_eq!(evaluation["negation"]["key"], "both");
    }

    #[test]
    fn el_oraculo_de_la_sesion_usa_el_pipeline_del_kernel() {
        let mut session = Session::new();
        assert!(session.is_empty());

        let result = session.converse("guarda");
        let turn = result.turn.as_ref().expect("el turno queda registrado");
        // El léxico es el del núcleo: «guarda» se destila a su raíz canónica.
        assert_eq!(turn.roots, "שמר");
        assert_eq!(turn.axioms, 0);
        assert!(!turn.intent.is_empty());
        assert!(turn.reply.contains("Δ reversibles"));
        assert_eq!(result.status.turns, 1);
        assert_eq!(
            result.status.last_reply.as_deref(),
            Some(turn.reply.as_str())
        );
        assert_eq!(session.script().len(), 1);
        assert_eq!(session.script()[0], "guarda");

        // Los comandos meta los responde el propio oráculo del kernel.
        let meta = session.converse(":estado");
        let meta_turn = meta.turn.as_ref().expect("el turno meta se registra");
        assert!(meta_turn.reply.contains("pila="));
        assert!(meta_turn.roots.is_empty());

        // Y el `Δ⁻¹` manual, con el mensaje del kernel cuando no hay marcas.
        let vacia = Session::new().converse(":deshacer");
        let deshacer = vacia.turn.as_ref().expect("el turno se registra");
        assert!(deshacer.reply.contains("nada que rebobinar"));

        session.reset();
        assert!(session.is_empty());
        assert_eq!(session.status().turns, 0);
    }

    #[test]
    fn la_sesion_es_determinista_y_el_rollback_idempotente() {
        // Firma determinista de una sesión: todo menos los campos de reloj
        // (A7). El guion evita `:deshacer` porque su respuesta cita los µs del
        // kernel y por tanto es informativa, no comparable.
        fn firma(session: &Session) -> Vec<(String, String, String, String, usize, usize)> {
            session
                .turns()
                .iter()
                .map(|turn| {
                    (
                        turn.input.clone(),
                        turn.intent.clone(),
                        turn.roots.clone(),
                        turn.reply.clone(),
                        turn.events,
                        turn.axioms,
                    )
                })
                .collect()
        }

        let mut una = Session::new();
        let mut otra = Session::new();
        for input in ["ברא", "guarda x", ":estado", ":memoria"] {
            una.converse(input);
            otra.converse(input);
        }
        assert_eq!(firma(&una), firma(&otra), "la sesión debe ser determinista");
        assert_eq!(una.status().turns, 4);
        assert_eq!(una.status().events, otra.status().events);
        assert_eq!(una.status().next_marker, otra.status().next_marker);

        // `Δ⁻¹` al marcador 0: revierte exactamente los deltas vivos.
        let antes = una.status();
        let rebobinada = una.rollback(0);
        let informe = rebobinada.rollbacks.last().expect("hay informe de Δ⁻¹");
        assert_eq!(informe.marker, 0);
        assert_eq!(informe.reverted, antes.deltas);
        assert_eq!(rebobinada.status.reverted, rebobinada.status.deltas);
        assert_eq!(rebobinada.status.applied_rollbacks, [0u64].as_slice());

        // Repetirlo no reintroduce nada: el `Δ⁻¹` del kernel es idempotente.
        let repetida = una.rollback(0);
        let segundo = repetida.rollbacks.last().expect("hay informe de Δ⁻¹");
        assert_eq!(segundo.reverted, 0);
        assert_eq!(repetida.status.reverted, repetida.status.deltas);
        assert_eq!(una.applied_rollbacks(), [0u64, 0u64].as_slice());

        // El diario se puede leer igual que `:timeline` en el REPL.
        for delta in una.deltas() {
            assert!(!delta.inverse.is_empty());
            assert!(delta.reverted);
        }
    }

    #[test]
    fn el_estado_de_la_sesion_no_retrocede() {
        let mut session = Session::new();
        let inicio = session.status();
        assert_eq!(inicio.turns, 0);
        assert_eq!(inicio.stack_depth, 0);
        assert_eq!(inicio.deltas, 0);
        assert_eq!(inicio.reverted, 0);
        assert_eq!(inicio.next_marker, 0);
        assert!(inicio.roots.is_empty());
        assert!(inicio.last_reply.is_none());
        assert_eq!(inicio.applied_rollbacks, [0u64; 0].as_slice());

        session.converse("ברא");
        let despues = session.status();
        assert_eq!(despues.turns, 1);
        assert!(despues.roots.contains(&"ברא".to_string()));
        assert!(despues.last_reply.is_some());
        // El marcador del kernel es el número de deltas registrados.
        assert_eq!(despues.next_marker, despues.deltas as u64);
        // Todo lo que mide el runtime crece o se queda igual, nunca decrece.
        assert!(despues.memory_nodes >= inicio.memory_nodes);
        assert!(despues.regions >= inicio.regions);
        assert!(despues.axioms >= inicio.axioms);
        assert!(despues.generation >= inicio.generation);
        assert!(despues.qubits >= inicio.qubits);
        assert!(despues.mesh_peers >= inicio.mesh_peers);
        assert!(despues.entropy >= 0.0);
        if let Some(top) = &despues.timeline_top {
            // La etiqueta la compone el kernel (`QuantumState::label`).
            assert!(top.contains('('));
            assert!(despues.timeline_observation.is_some());
        }
    }

    #[test]
    fn las_cuatro_valencias_de_belnap_son_las_del_kernel() {
        let values = belnap_values();
        assert_eq!(values.len(), 4);
        assert_eq!(values[0].key, "true");
        assert_eq!(values[1].key, "false");
        assert_eq!(values[2].key, "both");
        assert_eq!(values[3].key, "neither");

        // Los literales son los del núcleo (`Observation::glyph` / `name`).
        assert_eq!(values[0].observation.glyph, "⊤");
        assert_eq!(values[1].observation.glyph, "⊥");
        assert_eq!(values[2].observation.glyph, "⊤∧⊥");
        assert_eq!(values[3].observation.glyph, "∅");
        assert_eq!(values[0].observation.name, "verdadero");
        assert_eq!(values[2].observation.name, "contradicción tolerada");
        assert_eq!(values[3].observation.name, "indeterminado");

        // Masas: sólo la contradicción retiene ⊤ y ⊥ a la vez (A3 · Belnap acotado).
        assert_eq!((values[0].truth, values[0].falsity), (1.0, 0.0));
        assert_eq!((values[2].truth, values[2].falsity), (1.0, 1.0));
        assert!(values[2].contradiction);
        assert!(!values[0].contradiction);
        assert!(!values[3].contradiction);

        // Designación: únicamente el verdadero del kernel.
        assert!(values[0].designated);
        assert!(!values[1].designated);
        assert!(!values[2].designated);
        assert!(!values[3].designated);
    }

    #[test]
    fn la_bilattice_la_calcula_el_kernel_entera() {
        let lattice = belnap_lattice();
        assert_eq!(lattice.values.len(), 4);
        assert_eq!(lattice.negation.len(), 4);
        assert_eq!(lattice.conjunction.len(), 4);
        assert_eq!(lattice.disjunction.len(), 4);
        for row in &lattice.conjunction {
            assert_eq!(row.len(), 4);
            for cell in row {
                assert!(matches!(cell.key, "true" | "false" | "both" | "neither"));
            }
        }
        for row in &lattice.disjunction {
            assert_eq!(row.len(), 4);
            for cell in row {
                assert!(matches!(cell.key, "true" | "false" | "both" | "neither"));
            }
        }

        // Orden de `values`: [⊤, ⊥, ⊤∧⊥, ∅].
        assert_eq!(lattice.conjunction[0][0].key, "true"); // ⊤ ∧ ⊤ = ⊤
        assert_eq!(lattice.conjunction[0][1].key, "false"); // ⊤ ∧ ⊥ = ⊥
        assert_eq!(lattice.conjunction[2][2].key, "both"); // ⊤∧⊥ ∧ ⊤∧⊥ = ⊤∧⊥
        assert_eq!(lattice.conjunction[3][0].key, "neither"); // ∅ ∧ ⊤ = ∅
        assert_eq!(lattice.conjunction[2][3].key, "false"); // ⊤∧⊥ ∧ ∅ = ⊥
        assert_eq!(lattice.disjunction[0][1].key, "true"); // ⊤ ∨ ⊥ = ⊤
        assert_eq!(lattice.disjunction[2][3].key, "true"); // ⊤∧⊥ ∨ ∅ = ⊤
        assert_eq!(lattice.disjunction[1][1].key, "false"); // ⊥ ∨ ⊥ = ⊥
        assert_eq!(lattice.negation[0].key, "false"); // ¬⊤ = ⊥
        assert_eq!(lattice.negation[1].key, "true"); // ¬⊥ = ⊤
        assert_eq!(lattice.negation[2].key, "both"); // ¬(⊤∧⊥) = ⊤∧⊥
        assert_eq!(lattice.negation[3].key, "neither"); // ¬∅ = ∅
    }

    #[test]
    fn evaluar_un_par_recorta_las_masas_como_el_kernel() {
        let alta = belnap_evaluate(1.5, -0.5);
        assert_eq!(alta.point.truth, 1.0);
        assert_eq!(alta.point.falsity, 0.0);
        assert_eq!(alta.point.key, "true");
        assert!(alta.point.designated);
        assert_eq!(alta.negation.key, "false");

        // Las masas se publican tal cual las dejó el núcleo (sin re-clasificar).
        let media = belnap_evaluate(0.25, 0.75);
        assert_eq!(media.point.truth, 0.25);
        assert_eq!(media.point.falsity, 0.75);
        assert_eq!(media.negation.truth, 0.75);
        assert_eq!(media.negation.falsity, 0.25);

        // La contradicción absoluta se retiene y jamás explota.
        let paradoja = belnap_evaluate(1.0, 1.0);
        assert_eq!(paradoja.point.key, "both");
        assert!(paradoja.point.contradiction);
        assert_eq!(paradoja.negation.key, "both");
    }

    /// Invariante global: el recuento por clases suma exactamente los tokens.
    fn assert_counts_consistent(analysis: &Analysis) {
        let summary = &analysis.summary;
        let sum = summary.roots_known
            + summary.roots_unknown
            + summary.identifiers
            + summary.numbers
            + summary.strings
            + summary.punctuation
            + summary.newlines
            + summary.eof;
        assert_eq!(sum, summary.total, "las clases no suman el total");
        assert_eq!(analysis.tokens.len(), summary.total, "tokens != total");
    }

    #[test]
    fn la_entrada_vacia_solo_produce_el_centinela() {
        let analysis = analyze("");
        assert_eq!(analysis.summary.total, 1);
        assert_eq!(analysis.summary.eof, 1);
        assert_eq!(analysis.tokens[0].class, TokenClass::Eof);
        assert!(analysis.roots.is_empty());
        assert_counts_consistent(&analysis);
    }

    #[test]
    fn reconoce_una_raiz_conocida_con_su_glifo() {
        let analysis = analyze("ברא");
        let token = &analysis.tokens[0];
        assert_eq!(token.class, TokenClass::RootKnown);
        assert_eq!(token.lexeme, "ברא");
        assert_eq!(token.glyph, Some("ברא"));
        assert_eq!(token.meaning, Some("manifestar (creación ex nihilo)"));
        assert_eq!(analysis.roots.len(), 1);
        assert_eq!(analysis.roots[0].count, 1);
        assert_counts_consistent(&analysis);
    }

    #[test]
    fn una_raiz_desconocida_no_es_un_error() {
        let analysis = analyze("אבג");
        assert_eq!(analysis.tokens[0].class, TokenClass::RootUnknown);
        assert_eq!(analysis.tokens[0].glyph, None);
        assert_eq!(analysis.summary.roots_unknown, 1);
        assert!(analysis.roots.is_empty());
        assert_counts_consistent(&analysis);
    }

    #[test]
    fn clasifica_un_documento_completo() {
        let analysis = analyze("אמר x: 42 + \"hola\";\n");
        let summary = &analysis.summary;
        assert_eq!(summary.total, 9);
        assert_eq!(summary.roots_known, 1);
        assert_eq!(summary.identifiers, 1);
        assert_eq!(summary.numbers, 1);
        assert_eq!(summary.strings, 1);
        assert_eq!(summary.punctuation, 3);
        assert_eq!(summary.newlines, 1);
        assert_eq!(summary.eof, 1);

        let lexemes: Vec<&str> = analysis.tokens.iter().map(|t| t.lexeme.as_str()).collect();
        assert_eq!(lexemes, ["אמר", "x", ":", "42", "+", "hola", ";", "\n", ""]);
        assert_eq!(analysis.tokens[3].display, "Num(42)");
        assert_eq!(analysis.tokens[5].display, "Str(\"hola\")");
        assert_counts_consistent(&analysis);
    }

    #[test]
    fn el_informe_de_texto_respeta_los_modos() {
        let analysis = analyze("ברא");
        let tokens = render_report(&analysis, "<prueba>", ReportMode::Tokens);
        let summary = render_report(&analysis, "<prueba>", ReportMode::Summary);

        assert_eq!(analysis.summary.total, 2, "raiz + centinela EOF");
        let cabecera = format!("bara-ide {VERSION} - <prueba> - 2 tokens");
        assert!(tokens.starts_with(&cabecera));
        assert!(tokens.contains("Root(ברא ⇒ ברא)"));
        assert!(tokens.contains("clases lexicas"));
        assert!(tokens.contains("inventario de raices reconocidas"));

        // En modo resumen no se emite la tabla de tokens.
        assert!(!summary.contains("Root("));
        assert!(summary.contains("   raices conocidas   : 1"));
        assert!(summary.contains("x1"));
    }

    #[test]
    fn el_catalogo_viene_del_kernel() {
        let entries = catalogue();
        assert_eq!(entries.len(), 6);
        assert_eq!(entries[0].glyph, "ברא");
        assert!(entries.iter().all(|entry| !entry.meaning.is_empty()));

        let mut glyphs: Vec<&str> = entries.iter().map(|entry| entry.glyph).collect();
        glyphs.sort_unstable();
        glyphs.dedup();
        assert_eq!(glyphs.len(), 6, "glifos repetidos en el catalogo");
    }

    #[test]
    fn el_documento_de_ejemplo_es_analizable() {
        assert!(!SAMPLE_GENESIS.is_empty());
        let analysis = analyze(SAMPLE_GENESIS);
        assert!(analysis.summary.total > 1);
        assert!(analysis.summary.roots_known > 0);
        assert!(analysis.source_lines > 1);
        assert_counts_consistent(&analysis);
    }

    #[test]
    fn cualquier_entrada_es_tolerada() {
        // El kernel es total: ninguna de estas entradas puede provocar un fallo.
        for source in [
            "",
            "   \n\t ",
            "\u{0591}\u{05F3}\u{FFFD}",
            "\"sin cerrar",
            "12345678901234567890.5e-7",
            "!! ? -> : ; , * + א",
            "🙂🙃",
        ] {
            let analysis = analyze(source);
            assert_counts_consistent(&analysis);
        }
    }

    #[test]
    fn el_lexicon_del_kernel_traduce_lengua_natural() {
        // *Shoresh* directo: el manifiesto ya viene en raíces y el *nikud* se
        // pliega (exactamente la misma normalización que aplica el lexer).
        let directa = translate("בָּרָא");
        assert_eq!(directa.program, "ברא");
        assert_eq!(directa.roots, vec!["ברא".to_string()]);
        assert_eq!(directa.synthesized, 0);

        // Verbo del léxico del oráculo: se destila a su raíz canónica.
        let verbo = translate("guarda");
        assert_eq!(verbo.program, "שמר");
        assert_eq!(verbo.roots, vec!["שמר".to_string()]);
        assert_eq!(verbo.synthesized, 0);

        // Entrada puramente simbólica: el operador paraconsistente se conserva.
        assert_eq!(translate("!!").program, "!!");

        // Entrada vacía: nada que compilar y ningún fallo.
        let vacia = translate("");
        assert!(vacia.program.is_empty());
        assert!(vacia.roots.is_empty());
        assert_eq!(vacia.synthesized, 0);

        // Verbo desconocido: autopoiesis (raíz sintetizada de tres consonantes).
        let sintetizada = translate("termodinamica");
        assert_eq!(sintetizada.synthesized, 1);
        assert_eq!(sintetizada.roots.len(), 1);
        assert_eq!(sintetizada.roots[0].chars().count(), 3);
    }

    #[test]
    fn leer_un_archivo_inexistente_da_error_legible() {
        let error =
            read_source_file("C:/ruta/que/no/existe/en/absoluto.bara").expect_err("debe fallar");
        assert!(error.contains("no se pudo leer"));
    }

    /// Contrato IPC: el JSON que devuelve el backend (feature `serde`) usa
    /// exactamente las claves y clases que declara `web/src/engine.ts`.
    #[cfg(feature = "serde")]
    #[test]
    fn el_modelo_serializa_con_el_contrato_de_la_interfaz() {
        let analysis = analyze("ברא x: 42");
        let json = serde_json::to_value(&analysis).expect("el modelo debe serializar");

        assert!(json["sourceChars"].is_number());
        assert!(json["sourceLines"].is_number());
        assert_eq!(json["summary"]["rootsKnown"], 1);
        assert_eq!(json["summary"]["rootsUnknown"], 0);
        assert_eq!(json["summary"]["identifiers"], 1);
        assert_eq!(json["summary"]["numbers"], 1);
        assert_eq!(json["summary"]["total"], 5);
        assert_eq!(json["roots"][0]["glyph"], "ברא");
        assert_eq!(json["roots"][0]["count"], 1);

        let primer_token = &json["tokens"][0];
        assert_eq!(primer_token["class"], "rootKnown");
        assert_eq!(primer_token["lexeme"], "ברא");
        assert_eq!(primer_token["glyph"], "ברא");
        assert_eq!(primer_token["line"], 1);
        assert_eq!(primer_token["column"], 1);
        assert_eq!(json["tokens"][1]["class"], "identifier");
        assert_eq!(json["tokens"][2]["class"], "punctuation");
        assert_eq!(json["tokens"][3]["class"], "number");
        assert_eq!(json["tokens"][4]["class"], "eof");

        // Mismo contrato para la traducción del léxico (comando `shoresh_translate`).
        let traduccion =
            serde_json::to_value(translate("guarda")).expect("la traduccion debe serializar");
        assert_eq!(traduccion["program"], "שמר");
        assert_eq!(traduccion["roots"][0], "שמר");
        assert_eq!(traduccion["synthesized"], 0);
        assert!(traduccion["program"].is_string());
        assert!(serde_json::to_value(translate("")).is_ok());
    }
}

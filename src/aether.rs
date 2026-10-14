//! # Paneles AETHER‑Ω — proyección de los cuatro subsistemas del kernel
//!
//! Este módulo **no reimplementa** ningún subsistema de la fase AETHER‑Ω: los
//! **proyecta** desde el kernel `bara` a tipos planos que el backend Tauri
//! serializa a JSON y los paneles React pintan. Cada vista se construye
//! ejecutando el documento *Shoresh* del editor sobre un [`BaraRuntime`]
//! limpio, de modo que los paneles son **deterministas** (salvo los campos de
//! reloj, marcados **NO DETERMINISTAS**) y **totales** (ninguna entrada puede
//! abortar: el kernel degrada lo incomprensible a un valor *tolerado*).
//!
//! ## Mapa de paneles
//! * [`autopoiesis`] — **Fase 1**: las raíces que el kernel no conoce disparan
//!   la axiogénesis (`AutopoieticMutator`); cada axioma se valida con la
//!   biláttice de **Belnap** del propio núcleo y el AST entero pasa por la
//!   **puerta ZK** (`BaraRuntime::certify`).
//! * [`quantum_register`] — **Fase 2**: banco cuántico nativo (`Qubit<|ψ⟩>`,
//!   amplitudes complejas, interferencia de Hadamard y pares de Bell).
//! * [`mesh_status`] — **Fase 2**: malla holográfica global
//!   (`MeshCluster::synchronize`, bus en proceso o hilos `std`).
//! * [`metal_program`] — **Fase 2**: Metal‑IR, *layout* de registros y bypass
//!   del driver (`MetalMapper` a través del runtime).
//! * [`timeline`] — **Fase 2**: control temporal `Δ⁻¹` del documento.
//! * [`fractal_memory`] y [`fractal_plan`] — **Fase 3**: geometría áurea y de
//!   Fibonacci del reparto de la memoria holográfica (`FractalLayout`).
//!
//! ## Invariantes heredados
//! 1. **Cero lógica nueva**: cada número sale del núcleo; aquí sólo se eligen
//!    los parámetros de sondeo (derivados del documento) y se recortan los
//!    vectores para acotar el coste del panel.
//! 2. **Sin `unsafe`** y sin dependencias externas (la `serde` opcional es la
//!    misma *feature* del paquete).
//! 3. **Determinismo**: los sondeos no usan aleatoriedad; colapsos y huellas
//!    derivan de los hashes estables del kernel.

use crate::{saturate, BelnapPoint, Lexer, Token, TokenKind};
use bara::fractal_geometry::{fib_series, golden_angle, golden_slots, phi, FractalLayout};
use bara::memory_region::Device;
use bara::mesh_sync::MeshNode;
use bara::metal_ir::{capacity, layout_bytes, MetalOp, RegAllocation, RegisterClass};
use bara::quantum_native::{Amplitude, AmplitudeVector, BellPhase, EntanglementBinding, Qubit};
use bara::runtime::{Axiom, BaraRuntime, QuantumState};
use bara::temporal_rollback::{detect_paradox, Delta, DeltaKind, Paradox};
use bara::zk_proof::ZkCertificate;

// ─────────────────────────────────────────────────────────────────────────
// Cotas de los paneles
// ─────────────────────────────────────────────────────────────────────────

/// Cota de qubits vivos que el panel cuántico materializa.
pub const MAX_QUBITS: usize = 8;
/// Cota de instrucciones Metal‑IR proyectadas.
pub const MAX_INSTRUCTIONS: usize = 64;
/// Cota de palabras de la ISA de 32 bits proyectadas.
pub const MAX_WORDS: usize = 64;
/// Cota de deltas `Δ⁻¹` proyectados (los más recientes).
pub const MAX_DELTAS: usize = 128;
/// Cota de *peers* aceptados por el panel de malla.
pub const MAX_PEERS: usize = 16;
/// Cota de rondas de sincronización aceptadas por el panel de malla.
pub const MAX_ROUNDS: usize = 16;
/// Términos de Fibonacci publicados por el panel: `F(0) … F(n−1)`.
pub const FIBONACCI_TERMS: usize = 16;
/// Cota de rangos áureos publicados (permutación de *phyllotaxis*).
pub const MAX_GOLDEN_RANKS: usize = 64;

// ─────────────────────────────────────────────────────────────────────────
// Fase 1 — Autopoiesis, validación de Belnap y puerta ZK
// ─────────────────────────────────────────────────────────────────────────

/// Un axioma autopoiético proyectado (struct `Axiom` del kernel).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct AxiomView {
    /// Raíz que lo originó.
    pub root: String,
    /// Generación evolutiva en la que nació.
    pub generation: usize,
    /// Regla lógica inventada por el mutador del núcleo.
    pub rule: String,
    /// Valencia paraconsistente, clasificada por el kernel.
    pub valence: BelnapPoint,
    /// ¿La valencia es `⊤∧⊥` (contradicción retenida, jamás explosión)?
    pub tolerated: bool,
}

impl AxiomView {
    /// Proyecta un axioma: **ninguna** decisión lógica se toma aquí.
    fn project(axiom: &Axiom) -> Self {
        let valence = BelnapPoint::project(&axiom.valence);
        AxiomView {
            root: axiom.root.clone(),
            generation: axiom.generation,
            rule: axiom.rule.clone(),
            tolerated: valence.contradiction,
            valence,
        }
    }
}

/// Una comprobación de la puerta ZK (par `(nombre, superada)`).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ZkCheckView {
    /// Nombre de la comprobación, tal como lo redacta el kernel.
    pub name: String,
    /// ¿Se superó?
    pub passed: bool,
}

/// Certificado de la etapa de compilación (struct `ZkCertificate`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ZkGateView {
    /// Enunciado público certificado (`label` del kernel).
    pub label: String,
    /// Veredicto de la verificación independiente.
    pub verified: bool,
    /// Número de invariantes (grado del polinomio de anulación).
    pub constraints: usize,
    /// Punto-desafío Fiat–Shamir, en hexadecimal.
    pub challenge: String,
    /// Compromisos emitidos por el probador (`A B C H`).
    pub commitments: usize,
    /// Entradas públicas comprometidas.
    pub public_inputs: usize,
    /// Detalle de cada comprobación.
    pub checks: Vec<ZkCheckView>,
    /// Resumen textual del kernel para el log ontológico.
    pub summary: String,
}

impl ZkGateView {
    /// Proyecta el certificado del kernel (aquí nada se firma ni se verifica).
    fn project(certificate: &ZkCertificate) -> Self {
        ZkGateView {
            label: certificate.statement.label.clone(),
            verified: certificate.result.verified,
            constraints: certificate.statement.n_constraints,
            challenge: format!("0x{:016X}", certificate.proof.challenge.0),
            commitments: certificate.proof.commitments.len(),
            public_inputs: certificate.statement.public_inputs.len(),
            checks: certificate
                .result
                .checks
                .iter()
                .map(|(name, passed)| ZkCheckView {
                    name: name.clone(),
                    passed: *passed,
                })
                .collect(),
            summary: certificate.summary.clone(),
        }
    }
}

/// Informe de la fase 1 sobre el documento abierto.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct AutopoiesisReport {
    /// Raíces distintas vistas en el documento (conocidas y desconocidas).
    pub roots: usize,
    /// Raíces que el kernel no conoce: disparan la axiogénesis, en orden.
    pub unknown_roots: Vec<String>,
    /// Axiomas vivos del mutador, en orden determinista.
    pub axioms: Vec<AxiomView>,
    /// Generación evolutiva alcanzada por el lenguaje.
    pub generation: usize,
    /// Axiomas cuya valencia es `⊤∧⊥` (contradicciones **retenidas**).
    pub contradictions: usize,
    /// Puerta ZK sobre los invariantes autopoiéticos del AST.
    pub gate: ZkGateView,
    /// ¿El AST quedó certificado?
    pub certified: bool,
    /// Veredicto legible para la cabecera del panel.
    pub verdict: String,
}

/// **Fase 1** — Autopoiesis + Belnap + puerta ZK sobre un documento *Shoresh*.
///
/// Ejecuta el documento en un runtime limpio: cada raíz desconocida hace nacer
/// un axioma (`AutopoieticMutator`), el runtime clasifica su valencia y
/// `certify()` construye el sistema de restricciones con esos axiomas más los
/// invariantes paraconsistentes, emite la prueba y la verifica.
///
/// **Total**: cualquier texto —vacío o ilegible— produce un informe; sin raíces
/// desconocidas el mutador queda en generación 0 y la puerta certifica los
/// invariantes del runtime.
pub fn autopoiesis(source: &str) -> AutopoiesisReport {
    let (mut runtime, tokens) = runtime_of(source);
    let unknown_roots = unknown_roots_of(&tokens);
    let roots = roots_of(&tokens).len();
    let generation = runtime.mutator.generation();
    let axioms: Vec<AxiomView> = runtime.mutator.axioms().map(AxiomView::project).collect();
    let contradictions = axioms.iter().filter(|axiom| axiom.tolerated).count();
    // El préstamo del certificado vive sólo dentro de la expresión: el informe
    // es un valor propio, sin auto-referencias (y sin `unsafe`).
    let gate = ZkGateView::project(runtime.certify());
    let certified = gate.verified;
    let verdict = if certified {
        format!(
            "AST certificado · {} invariante(s) · {} axioma(s) autopoiético(s) · {} contradicción(es) tolerada(s)",
            gate.constraints,
            axioms.len(),
            contradictions
        )
    } else {
        format!(
            "certificado no verificado · {} invariante(s) · revisar los axiomas de la generación {}",
            gate.constraints, generation
        )
    };
    AutopoiesisReport {
        roots,
        unknown_roots,
        axioms,
        generation,
        contradictions,
        gate,
        certified,
        verdict,
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 3 — Geometría áurea y de Fibonacci de la memoria
// ─────────────────────────────────────────────────────────────────────────

/// Una fila del reparto áureo (nodo de la memoria holográfica).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct FractalCellView {
    /// Etiqueta lógica del nodo (`str:…`, `genesis:…`).
    pub label: String,
    /// Clave topológica (hash FNV‑1a), en hexadecimal.
    pub key: String,
    /// Ancho lógico del registro, en bytes.
    pub bytes: usize,
    /// Paso de retícula: el Fibonacci inmediatamente mayor (`fib_ceil`).
    pub stride: u64,
    /// Desplazamiento en bytes dentro de la retícula.
    pub slot: u64,
    /// Rango en la secuencia de *phyllotaxis* `i·φ`.
    pub rank: usize,
    /// Afinidad con el haz holográfico de reconstrucción, en `[0,1]`.
    pub affinity: f64,
}

/// **Fase 3** — Geometría fractal del reparto de memoria (struct `FractalLayout`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct FractalMemoryView {
    /// Nodos repartidos.
    pub nodes: usize,
    /// Bytes útiles retenidos.
    pub payload_bytes: u64,
    /// Extensión total de la retícula (`Σ strides`).
    pub span_bytes: u64,
    /// Relleno interno de la retícula.
    pub padding_bytes: u64,
    /// Fragmentación medida: `padding / span`.
    pub fragmentation: f64,
    /// Cota teórica de la retícula áurea (`1 − 1/φ`).
    pub bound: f64,
    /// Cota teórica de los cubos potencia de dos (`0.5`).
    pub baseline_bound: f64,
    /// Mejora relativa de la cota.
    pub improvement: f64,
    /// ¿La fragmentación medida respeta la cota áurea?
    pub within_bound: bool,
    /// Proporción áurea `φ` del núcleo.
    pub phi: f64,
    /// Ángulo áureo `2π/φ²`, en radianes.
    pub golden_angle: f64,
    /// Permutación de *phyllotaxis* del reparto (vacía si excede la cota).
    pub golden_ranks: Vec<usize>,
    /// Términos de Fibonacci publicados: `F(0) … F(n−1)`.
    pub fibonacci: Vec<u64>,
    /// Escrituras físicas efectivas de la memoria (idempotentes).
    pub writes: u64,
    /// Entropía acumulada de la memoria (0 ⇒ idempotente).
    pub entropy: f64,
    /// Etiqueta legible del reparto, redactada por el kernel.
    pub label: String,
    /// Filas del reparto, en orden de escritura.
    pub cells: Vec<FractalCellView>,
}

impl FractalMemoryView {
    /// Proyecta un reparto del kernel (las filas las aporta el llamante).
    fn project(
        layout: &FractalLayout,
        cells: Vec<FractalCellView>,
        writes: u64,
        entropy: f64,
    ) -> Self {
        let golden_ranks = if layout.nodes <= MAX_GOLDEN_RANKS {
            golden_slots(layout.nodes)
        } else {
            Vec::new()
        };
        FractalMemoryView {
            nodes: layout.nodes,
            payload_bytes: layout.payload_bytes,
            span_bytes: layout.span_bytes,
            padding_bytes: layout.padding_bytes,
            fragmentation: layout.fragmentation,
            bound: layout.bound,
            baseline_bound: layout.baseline_bound,
            improvement: layout.improvement,
            within_bound: layout.within_bound(),
            phi: phi(),
            golden_angle: golden_angle(),
            golden_ranks,
            fibonacci: fib_series(FIBONACCI_TERMS),
            writes,
            entropy,
            label: layout.label(),
            cells,
        }
    }

    /// Proyecta una fila del reparto con su rango de *phyllotaxis*.
    #[allow(clippy::too_many_arguments)]
    fn cell(
        label: Option<&str>,
        key: u64,
        bytes: usize,
        position: usize,
        ranks: &[usize],
        layout: &FractalLayout,
        affinity: f64,
        hex: bool,
    ) -> FractalCellView {
        FractalCellView {
            label: label.unwrap_or_default().to_string(),
            key: if hex {
                format!("0x{:016X}", key)
            } else {
                String::new()
            },
            bytes,
            stride: layout.stride_of(position).unwrap_or(0),
            slot: layout.slot_of(position).unwrap_or(0),
            rank: ranks.get(position).copied().unwrap_or(position),
            affinity,
        }
    }
}

/// **Fase 3** — Reparto áureo de los nodos de la memoria holográfica del
/// documento.
///
/// Ejecuta el documento y proyecta `HolographicMemory::layout()`: cada cadena
/// literal (y cada génesis `ברא`) retenida en memoria recibe su ranura, su paso
/// de Fibonacci (`fib_ceil`) y su rango en la secuencia `i·φ` — la misma
/// permutación de *phyllotaxis* que usa el reparto del núcleo.
pub fn fractal_memory(source: &str) -> FractalMemoryView {
    let (runtime, _tokens) = runtime_of(source);
    let layout = runtime.memory.layout();
    let ranks = golden_slots(layout.nodes);
    let cells = runtime
        .memory
        .grid()
        .iter()
        .enumerate()
        .map(|(position, (key, bytes))| {
            let node = runtime.memory.recall_by_key(*key);
            FractalMemoryView::cell(
                node.map(|held| held.label.as_str()),
                *key,
                *bytes,
                position,
                &ranks,
                &layout,
                node.map(|held| held.affinity).unwrap_or(0.0),
                true,
            )
        })
        .collect();
    FractalMemoryView::project(
        &layout,
        cells,
        runtime.memory.writes(),
        runtime.memory.entropy(),
    )
}

/// **Fase 3** — Reparto áureo *puro* de una población de anchos, sin runtime.
///
/// Sirve al panel para enseñar la rejilla `φ` con anchos arbitrarios y para las
/// pruebas de la cota de fragmentación. Con `widths` vacío, el reparto es el
/// vacío del kernel (cero nodos, cero fragmentación, cota respetada).
pub fn fractal_plan(widths: &[usize]) -> FractalMemoryView {
    let layout = FractalLayout::plan_from(widths);
    let ranks = golden_slots(layout.nodes);
    let cells = widths
        .iter()
        .enumerate()
        .map(|(position, bytes)| {
            let label = format!("nodo-{:02}", position);
            FractalMemoryView::cell(
                Some(label.as_str()),
                0,
                *bytes,
                position,
                &ranks,
                &layout,
                0.0,
                false,
            )
        })
        .collect();
    FractalMemoryView::project(&layout, cells, 0, 0.0)
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Banco cuántico nativo
// ─────────────────────────────────────────────────────────────────────────

/// Una amplitud compleja proyectada (`Amplitude`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct AmplitudeView {
    /// Etiqueta compacta `a+b·i` del kernel.
    pub label: String,
    /// Parte real.
    pub re: f64,
    /// Parte imaginaria.
    pub im: f64,
    /// Módulo `|α|`.
    pub magnitude: f64,
    /// Fase `arg(α)`, en radianes.
    pub phase: f64,
    /// Probabilidad de Born `|α|²`.
    pub probability: f64,
}

impl AmplitudeView {
    /// Proyecta una amplitud y su probabilidad de Born.
    fn project(amplitude: &Amplitude, probability: f64) -> Self {
        AmplitudeView {
            label: amplitude.label(),
            re: amplitude.re,
            im: amplitude.im,
            magnitude: amplitude.modulus(),
            phase: amplitude.phase(),
            probability,
        }
    }
}

/// Vector de amplitudes de un estado base o de un enlace.
fn amplitudes_of(vector: &AmplitudeVector) -> Vec<AmplitudeView> {
    vector
        .amplitudes
        .iter()
        .map(|amplitude| AmplitudeView::project(amplitude, amplitude.norm_sqr()))
        .collect()
}

/// Un qubit nativo proyectado (`Qubit<|ψ⟩>`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct QubitView {
    /// Nombre simbólico (la raíz del documento que lo materializó).
    pub name: String,
    /// Dimensión del espacio de Hilbert declarado.
    pub dim: usize,
    /// Etiquetas de la base computacional (`|0⟩`, `|1⟩`…).
    pub basis: Vec<String>,
    /// Amplitudes complejas.
    pub amplitudes: Vec<AmplitudeView>,
    /// Distribución de Born `|αᵢ|²`.
    pub probabilities: Vec<f64>,
    /// Entropía de Shannon, en bits.
    pub entropy_bits: f64,
    /// Probabilidad del estado más probable.
    pub top_probability: f64,
    /// Qubits con los que está entrelazado.
    pub entangled_with: Vec<String>,
    /// Índice medido, si colapsó.
    pub measured: Option<usize>,
    /// Etiqueta del resultado medido (`|0⟩`/`|⊤⟩`…).
    pub outcome: Option<String>,
    /// Mediciones aplicadas.
    pub measurements: u64,
    /// Valencia paraconsistente (traza parcial si está entrelazado).
    pub valence: BelnapPoint,
}

impl QubitView {
    /// Proyecta un qubit: la valencia la decide `Qubit::valence()` del kernel.
    fn project(qubit: &Qubit) -> Self {
        QubitView {
            name: qubit.name.clone(),
            dim: qubit.dim(),
            basis: qubit.basis.iter().map(|base| base.label.clone()).collect(),
            amplitudes: amplitudes_of(&qubit.amplitudes),
            probabilities: qubit.probabilities(),
            entropy_bits: qubit.entropy_bits(),
            top_probability: qubit.top_probability(),
            entangled_with: qubit.entangled_with.clone(),
            measured: qubit.measured,
            outcome: qubit.outcome_label(),
            measurements: qubit.measurements,
            valence: BelnapPoint::project(&qubit.valence()),
        }
    }
}

/// Un enlace de entrelazamiento proyectado (`EntanglementBinding`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct BindingView {
    /// Etiqueta del enlace, redactada por el kernel.
    pub label: String,
    /// Mitad izquierda.
    pub left: String,
    /// Mitad derecha.
    pub right: String,
    /// Convención de Bell (`Φ⁺`, `Φ⁻`, `Ψ⁺`, `Ψ⁻`).
    pub phase: &'static str,
    /// Significado ontológico de la convención.
    pub meaning: &'static str,
    /// Correlación esperada `⟨A·B⟩` de la convención.
    pub correlation: f64,
    /// Fuerza del enlace, en `[0,1]`.
    pub strength: f64,
    /// Época en la que se estableció.
    pub epoch: u64,
    /// Vector conjunto de la campana (cuatro amplitudes).
    pub joint: Vec<AmplitudeView>,
    /// Valencia de la descripción local (traza parcial ⇒ `⊤∧⊥`).
    pub valence: BelnapPoint,
}

impl BindingView {
    /// Proyecta un enlace y su descripción local (aquí nada se entrelaza).
    fn project(binding: &EntanglementBinding) -> Self {
        let label = binding.label();
        let joint = binding.joint();
        // La traza parcial de la campana es máxima mixtura: se consulta al
        // kernel construyendo el qubit conjunto, nunca calculándola aquí.
        let valence = Qubit::new(label.clone(), joint.clone()).valence();
        BindingView {
            label,
            left: binding.left.clone(),
            right: binding.right.clone(),
            phase: binding.phase.label(),
            meaning: binding.phase.meaning(),
            correlation: binding.phase.correlation(),
            strength: binding.strength,
            epoch: binding.epoch,
            joint: amplitudes_of(&joint),
            valence: BelnapPoint::project(&valence),
        }
    }
}

/// Una convención de Bell con su campana conjunta (catálogo del panel).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct BellView {
    /// Convención (`Φ⁺`, `Φ⁻`, `Ψ⁺`, `Ψ⁻`).
    pub phase: &'static str,
    /// Significado ontológico.
    pub meaning: &'static str,
    /// Correlación esperada `⟨A·B⟩`.
    pub correlation: f64,
    /// Vector conjunto de las cuatro amplitudes.
    pub joint: Vec<AmplitudeView>,
}

impl BellView {
    /// Proyecta una convención de Bell (catálogo estático del kernel).
    fn project(phase: BellPhase) -> Self {
        BellView {
            phase: phase.label(),
            meaning: phase.meaning(),
            correlation: phase.correlation(),
            joint: amplitudes_of(&phase.joint()),
        }
    }
}

/// **Fase 2** — Banco cuántico del documento, materializado sobre el kernel.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct QuantumView {
    /// Registro de qubits vivos, en orden determinista (BTreeMap del kernel).
    pub register: Vec<QubitView>,
    /// Enlaces de entrelazamiento establecidos.
    pub bindings: Vec<BindingView>,
    /// Catálogo de las cuatro convenciones de Bell.
    pub bell: Vec<BellView>,
    /// Qubits vivos.
    pub qubits: usize,
    /// Colapsos acumulados.
    pub collapses: u64,
    /// Entropía media del registro, en bits.
    pub entropy_bits: f64,
    /// Fases áureas `i·θ_g` inyectadas a cada qubit, en radianes.
    pub phases: Vec<f64>,
    /// Etiqueta legible del banco para la cabecera del panel.
    pub label: String,
}

/// **Fase 2** — Registro cuántico nativo derivado del documento.
///
/// El banco se materializa con la física del kernel, no con aritmética local:
/// 1. Cada raíz distinta del documento (hasta [`MAX_QUBITS`]) levanta un qubit
///    con amplitudes `α = e^{i·i·θ_g}`, `β = 1` (`superpose_native`), donde
///    `θ_g` es el ángulo áureo del núcleo.
/// 2. Se aplica la puerta de Hadamard del núcleo: la fase áurea interfiere y el
///    qubit queda con `p₀ = cos²(i·θ_g/2)`, `p₁ = sin²(i·θ_g/2)`.
/// 3. Los qubits se emparejan en campanas de Bell con las cuatro convenciones
///    rotando (traza parcial ⇒ valencia `⊤∧⊥` **tolerada**).
/// 4. El último qubit se colapsa por la regla de Born, propagando **no
///    localmente** el resultado a su socio entrelazado.
///
/// **Determinista**: sin aleatoriedad; los colapsos derivan de la semilla
/// estable del kernel. Un documento sin raíces produce un banco vacío (no un
/// error).
pub fn quantum_register(source: &str) -> QuantumView {
    let (mut runtime, tokens) = runtime_of(source);
    let names: Vec<String> = roots_of(&tokens).into_iter().take(MAX_QUBITS).collect();
    let phases: Vec<f64> = (0..names.len())
        .map(|index| golden_angle() * index as f64)
        .collect();
    for (name, theta) in names.iter().zip(phases.iter()) {
        let _ = runtime.superpose_native(
            name,
            Amplitude::from_polar(1.0, *theta),
            Amplitude::real(1.0),
        );
        let _ = runtime.qubits.hadamard(name);
    }
    for (index, pair) in names.chunks(2).enumerate() {
        if let [left, right] = pair {
            let _ = runtime.entangle_native(left, right, BellPhase::all()[index % 4]);
        }
    }
    if let Some(name) = names.last() {
        let _ = runtime.collapse_native(name);
    }
    let register: Vec<QubitView> = runtime
        .qubits
        .names()
        .filter_map(|name| runtime.qubits.get(name).map(QubitView::project))
        .collect();
    let bindings: Vec<BindingView> = runtime
        .qubits
        .bindings()
        .iter()
        .map(BindingView::project)
        .collect();
    let bell: Vec<BellView> = BellPhase::all()
        .iter()
        .copied()
        .map(BellView::project)
        .collect();
    let entropy_bits = if register.is_empty() {
        0.0
    } else {
        register.iter().map(|qubit| qubit.entropy_bits).sum::<f64>() / register.len() as f64
    };
    let collapses = runtime.qubits.collapses();
    let label = format!(
        "banco cuántico · {} qubit(s) · {} enlace(s) · {} colapso(s)",
        register.len(),
        bindings.len(),
        collapses
    );
    QuantumView {
        qubits: register.len(),
        register,
        bindings,
        bell,
        collapses,
        entropy_bits,
        phases,
        label,
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Malla holográfica global
// ─────────────────────────────────────────────────────────────────────────

/// Un nodo (réplica) de la malla proyectado (`MeshNode`).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct MeshNodeView {
    /// Identificador del nudo en la retícula.
    pub id: usize,
    /// Nombre simbólico del nudo.
    pub name: String,
    /// Entradas retenidas.
    pub entries: usize,
    /// Huella holográfica conjunta, en hexadecimal.
    pub hologram: String,
    /// Época conocida.
    pub epoch: u64,
    /// Marcos aceptados.
    pub applied: u64,
    /// Marcos rechazados (divergencias no fusionables).
    pub rejected: u64,
    /// Reloj vectorial, redactado por el kernel.
    pub clock: String,
}

/// **Fase 2** — Estado de la malla holográfica tras sincronizar.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct MeshView {
    /// Rondas efectivas.
    pub rounds: usize,
    /// Peers participantes.
    pub peers: usize,
    /// Entradas participantes.
    pub entries: usize,
    /// Entradas fusionadas.
    pub merged: usize,
    /// Conflictos resueltos por reloj vectorial.
    pub conflicts: usize,
    /// Marcos obsoletos descartados.
    pub stale: usize,
    /// Marcos sin efecto (idempotencia).
    pub noop: usize,
    /// Entregas del bus.
    pub deliveries: u64,
    /// Bytes de cable.
    pub wire_bytes: usize,
    /// Digest de consenso, en hexadecimal.
    pub digest: String,
    /// Época de la malla.
    pub epoch: u64,
    /// ¿Convergió la retícula?
    pub converged: bool,
    /// Deriva entre huellas.
    pub drift: f64,
    /// ¿Se sincronizó con hilos `std`?
    pub threaded: bool,
    /// Duración del ciclo en microsegundos (**NO DETERMINISTA**: reloj de pared).
    pub micros: u64,
    /// Etiqueta legible del informe, redactada por el kernel.
    pub label: String,
    /// Réplicas, en orden estable.
    pub nodes: Vec<MeshNodeView>,
}

impl MeshNodeView {
    /// Proyecta una réplica (la huella la calcula el kernel).
    fn project(node: &MeshNode) -> Self {
        MeshNodeView {
            id: node.id,
            name: node.name.clone(),
            entries: node.len(),
            hologram: format!("0x{:016X}", node.hologram()),
            epoch: node.epoch(),
            applied: node.applied(),
            rejected: node.rejected(),
            clock: node.clock().label(),
        }
    }
}

/// **Fase 2** — Sincroniza la malla holográfica del documento y la proyecta.
///
/// Siembra una réplica por región viva del runtime (la primera sincronización
/// lo hace automáticamente), converge con relojes vectoriales y digest
/// FNV‑1a, y devuelve tanto el informe del kernel como el estado de cada nudo.
///
/// `peers` se acota a `1..=`[`MAX_PEERS`] y `rounds` a `1..=`[`MAX_ROUNDS`]
/// (el coste del panel queda acotado y la elección documentada). Con
/// `threaded = true` el kernel reparte el bus con hilos `std`: el **estado**
/// convergido y el digest no cambian (derivan del contenido), pero los relojes
/// vectoriales y la duración sí dependen del planificador.
pub fn mesh_status(source: &str, peers: usize, rounds: usize, threaded: bool) -> MeshView {
    let (mut runtime, _tokens) = runtime_of(source);
    let peers = peers.clamp(1, MAX_PEERS);
    let rounds = rounds.clamp(1, MAX_ROUNDS);
    let report = runtime.mesh_sync(peers, rounds, threaded);
    let nodes = runtime
        .mesh
        .nodes()
        .iter()
        .map(MeshNodeView::project)
        .collect();
    MeshView {
        rounds: report.rounds,
        peers: report.peers,
        entries: report.entries,
        merged: report.merged,
        conflicts: report.conflicts,
        stale: report.stale,
        noop: report.noop,
        deliveries: report.deliveries,
        wire_bytes: report.wire_bytes,
        digest: format!("0x{:016X}", report.digest),
        epoch: runtime.mesh.epoch(),
        converged: report.converged,
        drift: report.drift,
        threaded: report.threaded,
        micros: saturate(report.micros),
        label: report.label(),
        nodes,
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Metal‑IR y bypass del driver
// ─────────────────────────────────────────────────────────────────────────

/// Una instrucción Metal‑IR proyectada (`MetalOp`).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct MetalOpView {
    /// Palabra codificada de 32 bits, en hexadecimal.
    pub word: String,
    /// Mnemónico del opcode.
    pub opcode: String,
    /// ¿Es una barrera de sincronización de hilos?
    pub barrier: bool,
    /// Registro destino (virtual).
    pub dst: Option<usize>,
    /// Registros fuente (virtuales).
    pub src: Vec<usize>,
    /// Inmediato, si lo hay.
    pub imm: Option<i64>,
    /// Carriles SIMD despachados.
    pub lanes: u32,
    /// Máscara de carriles efectiva.
    pub lane_mask: u32,
    /// Ciclos de emisión.
    pub cycles: u32,
    /// Latencia del opcode en el modelo del kernel.
    pub latency: u32,
    /// Regla del lenguaje que la originó.
    pub origin: String,
    /// Notación legible del kernel.
    pub describe: String,
}

impl MetalOpView {
    /// Proyecta una instrucción (la codificación la produce el kernel).
    fn project(op: &MetalOp) -> Self {
        MetalOpView {
            word: format!("0x{:08X}", op.encode()),
            opcode: op.opcode.label().to_string(),
            barrier: op.opcode.is_barrier(),
            dst: op.dst,
            src: op.src.clone(),
            imm: op.imm,
            lanes: op.lanes,
            lane_mask: op.lane_mask(),
            cycles: op.cycles,
            latency: op.opcode.latency(),
            origin: op.origin.clone(),
            describe: op.describe(),
        }
    }
}

/// Un banco de registros con su ocupación (`RegisterBank` + `RegAllocation`).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct RegisterView {
    /// Prefijo de clase (`R`, `F`, `V`, `P`, `S`).
    pub class: String,
    /// Glifo del log ontológico.
    pub glyph: String,
    /// Descripción del banco, redactada por el kernel.
    pub label: String,
    /// Registros del banco.
    pub slots: usize,
    /// Registros asignados.
    pub used: usize,
    /// Ocupación `used / slots`.
    pub ratio: f64,
    /// Anchura en bytes.
    pub width: usize,
    /// Alineación natural en bytes.
    pub alignment: usize,
    /// ¿Banco enmascarado (SIMD)?
    pub masking: bool,
    /// Bytes totales del banco.
    pub bank_bytes: usize,
}

impl RegisterView {
    /// Proyecta un banco con su uso real en la asignación del kernel.
    fn project(class: RegisterClass, allocation: &RegAllocation) -> Self {
        let bank = class.bank();
        let slots = class.slots();
        let used = allocation.usage(class);
        RegisterView {
            class: class.label().to_string(),
            glyph: class.glyph().to_string(),
            label: bank.label(),
            slots,
            used,
            ratio: if slots == 0 {
                0.0
            } else {
                used as f64 / slots as f64
            },
            width: bank.width,
            alignment: bank.alignment,
            masking: bank.masking,
            bank_bytes: bank.bytes(),
        }
    }
}

/// Dispositivo consumidor a partir del nombre que envía el panel.
fn device_of(name: &str) -> Device {
    match name.trim().to_lowercase().as_str() {
        "gpu" | "metal" | "vector" => Device::Gpu,
        _ => Device::Cpu,
    }
}

/// **Fase 2** — Metal‑IR del documento con despacho y bypass del driver.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct MetalView {
    /// Etiqueta del programa.
    pub label: String,
    /// Nombre del dispositivo destino, tal como se pidió.
    pub device: String,
    /// Etiqueta del dispositivo (`CPU`/`GPU`).
    pub device_label: &'static str,
    /// Instrucciones emitidas.
    pub ops: usize,
    /// Instrucciones proyectadas (recortadas a [`MAX_INSTRUCTIONS`]).
    pub instructions: Vec<MetalOpView>,
    /// ¿Se recortó algún vector para el panel?
    pub truncated: bool,
    /// Palabras de la ISA de 32 bits (recortadas a [`MAX_WORDS`]).
    pub words: Vec<String>,
    /// Palabras totales emitidas.
    pub word_count: usize,
    /// Carriles por registro.
    pub lanes: u32,
    /// Barreras de sincronización.
    pub barriers: usize,
    /// Registros virtuales asignados.
    pub allocated: usize,
    /// Registros desbordados a memoria.
    pub spilled: usize,
    /// Bytes derramados.
    pub spill_bytes: usize,
    /// Presión de registros, en `[0,1]`.
    pub pressure: f64,
    /// Ocupación del banco, en `[0,1]`.
    pub occupancy: f64,
    /// Capacidad física total (descriptor de hardware).
    pub capacity: usize,
    /// Bytes del layout físico de registros.
    pub layout_bytes: usize,
    /// Rangos de vida considerados.
    pub ranges: usize,
    /// Descriptor de hardware, en hexadecimal.
    pub descriptor: String,
    /// Entradas del anillo de comandos del bypass.
    pub ring_entries: u32,
    /// Llamadas al sistema evitadas.
    pub avoided_syscalls: usize,
    /// Latencia ahorrada por el bypass, en nanosegundos.
    pub latency_saved_ns: u64,
    /// Base MMIO del bypass, en hexadecimal.
    pub mmio_base: String,
    /// Oleadas del despacho.
    pub waves: usize,
    /// Carriles del despacho.
    pub dispatch_lanes: u32,
    /// Ciclos del despacho.
    pub dispatch_cycles: u32,
    /// Ocupación del despacho, en `[0,1]`.
    pub dispatch_occupancy: f64,
    /// Llamadas al sistema evitadas según el despacho.
    pub bypassed_syscalls: usize,
    /// Firma de la ISA completa, redactada por el kernel.
    pub signature: String,
    /// Resumen del despacho, redactado por el kernel.
    pub dispatch: String,
    /// Resumen del bypass, redactado por el kernel.
    pub bypass: String,
    /// Bancos de registros con su ocupación.
    pub registers: Vec<RegisterView>,
}

/// **Fase 2** — Baja el documento a Metal‑IR con el *lowering* del kernel.
///
/// Ejecuta el documento y llama a `BaraRuntime::lower_metal` (que envuelve a
/// `MetalMapper::lower`): el kernel recorre los tokens, emite las palabras de
/// 32 bits, resuelve los rangos de vida, asigna registros físicos, derrama lo
/// que no cabe y publica el bypass de driver. El panel se limita a recortar los
/// vectores (documentado en `truncated`) y a formatear.
///
/// `device` acepta `"gpu"`/`"metal"`/`"vector"` (despacho vectorial) y cualquier
/// otra cosa es CPU.
pub fn metal_program(source: &str, device: &str) -> MetalView {
    let (mut runtime, tokens) = runtime_of(source);
    let device = device_of(device);
    let label = format!("AST-Bara·{}", device.label());
    let program = runtime.lower_metal(&label, device, &tokens);
    let words = program.words();
    let dispatch = program.dispatch();
    let truncated = words.len() > MAX_WORDS || program.ops.len() > MAX_INSTRUCTIONS;
    MetalView {
        label: program.label.clone(),
        device: device.label().to_lowercase(),
        device_label: device.label(),
        ops: program.ops.len(),
        instructions: program
            .ops
            .iter()
            .take(MAX_INSTRUCTIONS)
            .map(MetalOpView::project)
            .collect(),
        truncated,
        words: words
            .iter()
            .take(MAX_WORDS)
            .map(|word| format!("0x{:08X}", word))
            .collect(),
        word_count: words.len(),
        lanes: program.lanes(),
        barriers: program.barriers(),
        allocated: program.allocation.allocated(),
        spilled: program.allocation.spilled(),
        spill_bytes: program.allocation.spill_bytes(),
        pressure: program.allocation.pressure(),
        occupancy: program.allocation.occupancy(),
        capacity: capacity(),
        layout_bytes: layout_bytes(),
        ranges: program.ranges.len(),
        descriptor: format!("0x{:016X}", program.descriptor()),
        ring_entries: program.bypass.ring_entries,
        avoided_syscalls: program.bypass.avoided_syscalls,
        latency_saved_ns: program.bypass.latency_saved_ns,
        mmio_base: format!("0x{:X}", program.bypass.mmio_base),
        waves: dispatch.waves,
        dispatch_lanes: dispatch.lanes,
        dispatch_cycles: dispatch.cycles,
        dispatch_occupancy: dispatch.occupancy,
        bypassed_syscalls: dispatch.bypassed_syscalls,
        signature: program.signature(),
        dispatch: dispatch.label(),
        bypass: program.bypass.label(),
        registers: RegisterClass::all()
            .iter()
            .map(|class| RegisterView::project(*class, &program.allocation))
            .collect(),
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 — Control temporal Δ⁻¹
// ─────────────────────────────────────────────────────────────────────────

/// Un delta `Δ` del diario temporal proyectado.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct TimelineDeltaView {
    /// Identificador monótono del delta.
    pub id: u64,
    /// Etiqueta descriptiva, redactada por el kernel.
    pub label: String,
    /// Naturaleza del delta (`push`, `pop`, `replace`).
    pub kind: &'static str,
    /// Operador inverso `Δ⁻¹` asociado.
    pub inverse: &'static str,
    /// ¿Ya fue revertido?
    pub reverted: bool,
    /// Marca de reloj en microsegundos (**NO DETERMINISTA**: reloj de pared).
    pub at_micros: u64,
}

impl TimelineDeltaView {
    /// Proyecta un delta (el reloj se satura a `u64` para el panel).
    fn project(delta: &Delta) -> Self {
        TimelineDeltaView {
            id: delta.id,
            label: delta.label.clone(),
            kind: delta_kind_label(&delta.kind),
            inverse: delta.inv_label(),
            reverted: delta.reverted,
            at_micros: saturate(delta.at_micros),
        }
    }
}

/// Naturaleza de un delta, según el enumerado del kernel.
///
/// El `match` es **exhaustivo a propósito**: si el kernel añade una variante,
/// esta proyección deja de compilar hasta que el panel sepa pintarla.
fn delta_kind_label(kind: &DeltaKind) -> &'static str {
    match kind {
        DeltaKind::Push(_) => "push",
        DeltaKind::Pop(_) => "pop",
        DeltaKind::Replace { .. } => "replace",
    }
}

/// Una paradoja irresoluble detectada por el kernel (`⊤∧⊥` absoluto).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct ParadoxView {
    /// Descripción ontológica.
    pub description: String,
    /// Masa de verdad.
    pub truth: f64,
    /// Masa de falsedad.
    pub falsity: f64,
}

impl ParadoxView {
    /// Proyecta una paradoja.
    fn project(paradox: &Paradox) -> Self {
        ParadoxView {
            description: paradox.description.clone(),
            truth: paradox.truth,
            falsity: paradox.falsity,
        }
    }
}

/// **Fase 2** — Diario `Δ⁻¹` del documento y cumbre de la pila de estados.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct TimelineView {
    /// Deltas proyectados (los más recientes, hasta [`MAX_DELTAS`]).
    pub deltas: Vec<TimelineDeltaView>,
    /// Deltas totales del diario.
    pub total: usize,
    /// ¿Se recortó el diario para el panel?
    pub truncated: bool,
    /// Deltas vivos (no revertidos).
    pub live: usize,
    /// Deltas ya revertidos por un `Δ⁻¹`.
    pub reverted: usize,
    /// Profundidad de la pila de estados.
    pub depth: usize,
    /// Marca lógica del instante actual (próximo identificador).
    pub next_marker: u64,
    /// Pila de estados como etiquetas (la cumbre al final).
    pub stack: Vec<String>,
    /// Valencia de la cumbre de la pila.
    pub top: Option<BelnapPoint>,
    /// Etiqueta de la cumbre de la pila.
    pub top_label: Option<String>,
    /// Paradoja detectada en la cumbre, si la hay.
    pub paradox: Option<ParadoxView>,
    /// Etiqueta legible para la cabecera del panel.
    pub label: String,
}

/// **Fase 2** — Control temporal del documento: pila de estados y diario `Δ⁻¹`.
///
/// Ejecuta el documento: cada colapso paraconsistente deja su delta en el
/// diario del núcleo (`TemporalEngine`), y las contradicciones absolutas
/// disparan el rollback atómico `rollback_paradox`. El panel sólo lee: la pila,
/// la cumbre (con su valencia y su paradoja) y el diario completo.
pub fn timeline(source: &str) -> TimelineView {
    let (runtime, _tokens) = runtime_of(source);
    let engine = &runtime.timeline;
    let all = engine.deltas();
    let start = all.len().saturating_sub(MAX_DELTAS);
    let deltas: Vec<TimelineDeltaView> = all[start..]
        .iter()
        .map(TimelineDeltaView::project)
        .collect();
    let top = engine.stack().last();
    let stack: Vec<String> = engine.stack().iter().map(QuantumState::label).collect();
    let total = all.len();
    let reverted = all.iter().filter(|delta| delta.reverted).count();
    let live = total - reverted;
    let paradox = top
        .and_then(detect_paradox)
        .map(|found| ParadoxView::project(&found));
    let label = format!(
        "timeline · {} delta(s) · {} vivo(s) · profundidad {} · marca {}",
        total,
        live,
        engine.stack().len(),
        engine.mark().0
    );
    TimelineView {
        deltas,
        total,
        truncated: start > 0,
        live,
        reverted,
        depth: engine.stack().len(),
        next_marker: engine.mark().0,
        stack,
        top: top.map(BelnapPoint::project),
        top_label: top.map(QuantumState::label),
        paradox,
        label,
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Utilidades compartidas por los paneles
// ─────────────────────────────────────────────────────────────────────────

/// Ejecuta un documento en un runtime limpio del kernel.
///
/// Devuelve también los tokens para que cada panel elija su sondeo (registro
/// cuántico, Metal‑IR…) sin volver a lexear. La ejecución es **total**: el
/// runtime del núcleo registra eventos y degrada lo incomprensible.
fn runtime_of(source: &str) -> (BaraRuntime, Vec<Token>) {
    let tokens = Lexer::new(source).tokenize();
    let mut runtime = BaraRuntime::new();
    let _ = runtime.execute(&tokens);
    (runtime, tokens)
}

/// Raíces del documento, en orden de aparición y sin repetir.
fn roots_of(tokens: &[Token]) -> Vec<String> {
    let mut roots: Vec<String> = Vec::new();
    for token in tokens {
        if let TokenKind::Root { letters, .. } = &token.kind {
            if !letters.is_empty() && !roots.iter().any(|known| known == letters) {
                roots.push(letters.clone());
            }
        }
    }
    roots
}

/// Raíces que el kernel **desconoce** (sin [`Keyword`] en el léxico): son las
/// que disparan la axiogénesis del `AutopoieticMutator`, en orden.
fn unknown_roots_of(tokens: &[Token]) -> Vec<String> {
    let mut roots: Vec<String> = Vec::new();
    for token in tokens {
        if let TokenKind::Root { letters, keyword } = &token.kind {
            if keyword.is_none() && !roots.iter().any(|known| known == letters) {
                roots.push(letters.clone());
            }
        }
    }
    roots
}

// ─────────────────────────────────────────────────────────────────────────
// Pruebas de las proyecciones
// ─────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Documento con una raíz conocida y varias desconocidas (axiogénesis).
    const DOCUMENTO: &str = r#"
        ברא
        אבג צור
        "uno" "dos"
        1 + 2
    "#;

    #[test]
    fn autopoiesis_axiogeniza_y_certifica() {
        let report = autopoiesis(DOCUMENTO);
        assert!(report.roots >= 2, "el documento declara varias raíces");
        assert!(
            report.unknown_roots.contains(&"אבג".to_string()),
            "las raíces sin glosa disparan la axiogénesis: {:?}",
            report.unknown_roots
        );
        assert_eq!(
            report.axioms.len(),
            report.unknown_roots.len(),
            "un axioma por raíz desconocida"
        );
        assert!(
            report.gate.verified,
            "la puerta ZK certifica los invariantes"
        );
        assert_eq!(report.gate.commitments, 4, "el probador emite A B C H");
        assert_eq!(
            report.contradictions,
            report.axioms.iter().filter(|a| a.tolerated).count()
        );
        assert!(report.verdict.contains("certificado"));
    }

    #[test]
    fn autopoiesis_es_total_sin_raices() {
        let vacio = autopoiesis("");
        assert_eq!(vacio.roots, 0);
        assert!(vacio.axioms.is_empty());
        assert!(
            vacio.gate.verified,
            "sin axiomas sólo quedan los invariantes"
        );
        assert_eq!(vacio.generation, 0);
    }

    #[test]
    fn autopoiesis_es_determinista() {
        assert_eq!(autopoiesis(DOCUMENTO), autopoiesis(DOCUMENTO));
    }

    #[test]
    fn fractal_plan_respeta_la_cota_ancha() {
        let anchos = [1_usize, 2, 3, 5, 8, 13, 21, 34];
        let plan = fractal_plan(&anchos);
        assert_eq!(plan.nodes, anchos.len());
        assert!(plan.within_bound, "el reparto áureo respeta su cota");
        assert!(
            plan.bound < plan.baseline_bound,
            "φ mejora al cubo potencia de dos"
        );
        assert_eq!(plan.golden_ranks.len(), anchos.len());
        assert_eq!(plan.fibonacci.first().copied(), Some(0));
        assert_eq!(plan.fibonacci.get(1).copied(), Some(1));
        assert_eq!(plan.cells.len(), anchos.len());
        for (indice, celda) in plan.cells.iter().enumerate() {
            assert!(
                celda.stride >= anchos[indice] as u64,
                "fib_ceil cubre el ancho"
            );
            assert!(celda.rank < anchos.len(), "el rango es una permutación");
        }
    }

    #[test]
    fn fractal_memory_reparte_los_nodos() {
        let reparto = fractal_memory(r#""uno" "dos" "tres""#);
        assert_eq!(reparto.nodes, 3);
        assert_eq!(reparto.cells.len(), 3);
        assert!(reparto.span_bytes >= reparto.payload_bytes);
        assert!(reparto.phi > 1.0, "φ es la proporción áurea del kernel");
        assert!(reparto.golden_angle > 0.0);
        assert_eq!(reparto.golden_ranks.len(), 3);
    }

    #[test]
    fn quantum_register_usa_el_kernel_y_es_determinista() {
        let banco = quantum_register(DOCUMENTO);
        assert!(!banco.register.is_empty(), "el documento levanta qubits");
        assert!(banco.register.len() <= MAX_QUBITS);
        assert_eq!(banco.bell.len(), 4, "las cuatro convenciones de Bell");
        assert_eq!(banco.phases.len(), banco.register.len());
        for qubit in &banco.register {
            let suma: f64 = qubit.probabilities.iter().sum();
            assert!((suma - 1.0).abs() < 1e-9, "Born normaliza: {}", qubit.name);
            assert!(qubit.entropy_bits <= (qubit.dim as f64) + 1e-9);
            assert!((0.0..=1.0).contains(&qubit.top_probability));
        }
        assert_eq!(banco, quantum_register(DOCUMENTO), "sin aleatoriedad");
    }

    #[test]
    fn mesh_status_converge_en_la_reticula() {
        let malla = mesh_status(DOCUMENTO, 3, 2, false);
        assert_eq!(malla.peers, 3);
        assert_eq!(malla.nodes.len(), 3);
        assert!(malla.converged, "los relojes vectoriales convergen");
        assert!(malla.digest.starts_with("0x"));
        assert!(!malla.threaded);
        let hilos = mesh_status(DOCUMENTO, 3, 2, true);
        assert_eq!(hilos.nodes.len(), 3);
        assert!(hilos.threaded);
        // El bus en hilos sólo cambia la planificación (relojes vectoriales y
        // duración); el **estado** convergido sigue siendo el mismo: el digest
        // del kernel deriva del contenido (`hologram_of`), no del planificador.
        assert_eq!(malla.digest, hilos.digest, "el digest deriva del contenido");
        let hologramas = |vista: &MeshView| -> Vec<String> {
            vista
                .nodes
                .iter()
                .map(|peer| peer.hologram.clone())
                .collect()
        };
        assert_eq!(hologramas(&malla), hologramas(&hilos), "mismo holograma");
        for peer in &hilos.nodes {
            assert!(
                peer.applied >= peer.rejected,
                "el orden de fusión es parcial"
            );
            assert_eq!(peer.clock.split(',').count(), 3, "un carril por peer");
        }
    }

    #[test]
    fn mesh_status_acota_los_parametros() {
        let malla = mesh_status(DOCUMENTO, 0, 0, false);
        assert_eq!(malla.peers, 1, "los parámetros se acotan, no fallan");
        assert_eq!(malla.rounds, 1);
    }

    #[test]
    fn metal_program_publica_isa_y_registros() {
        let cpu = metal_program(DOCUMENTO, "cpu");
        assert_eq!(cpu.device_label, "CPU");
        assert_eq!(cpu.registers.len(), 5, "cinco bancos abstractos");
        assert!(cpu.capacity > 0);
        assert_eq!(cpu.words.len(), cpu.word_count.min(MAX_WORDS));
        assert_eq!(cpu.instructions.len(), cpu.ops.min(MAX_INSTRUCTIONS));
        assert_eq!(
            cpu.truncated,
            cpu.word_count > MAX_WORDS || cpu.ops > MAX_INSTRUCTIONS
        );
        let gpu = metal_program(DOCUMENTO, "gpu");
        assert_eq!(gpu.device_label, "GPU");
        assert!(
            gpu.lanes >= cpu.lanes,
            "el despacho vectorial no reduce carriles"
        );
    }

    #[test]
    fn timeline_expone_el_diario_marcado() {
        let linea = timeline(DOCUMENTO);
        assert_eq!(
            linea.next_marker, linea.total as u64,
            "la marca del kernel es el número de deltas registrados"
        );
        assert_eq!(linea.depth, linea.stack.len());
        assert_eq!(linea.live + linea.reverted, linea.total);
        assert!(!linea.label.is_empty());
    }

    /// Claves de un objeto JSON, ordenadas y unidas por comas: espejo exacto
    /// de los campos que declaran las interfaces de `web/src/aether.ts`.
    #[cfg(feature = "serde")]
    fn claves(valor: &serde_json::Value) -> String {
        let mut nombres: Vec<&str> = valor
            .as_object()
            .expect("un objeto JSON")
            .keys()
            .map(String::as_str)
            .collect();
        nombres.sort_unstable();
        nombres.join(",")
    }

    /// Contrato IPC de las proyecciones AETHER‑Ω: el JSON que devuelve el
    /// backend (feature `serde`) publica **exactamente** las claves de las
    /// interfaces de `web/src/aether.ts` — el mismo papel que cumple
    /// `el_modelo_serializa_con_el_contrato_de_la_interfaz` para `engine.ts`.
    #[cfg(feature = "serde")]
    #[test]
    fn las_proyecciones_serializan_con_el_contrato_de_la_interfaz() {
        /// Claves de `FractalMemoryView` (compartidas por los dos comandos).
        const CONTRATO_FRACTAL: &str = "baselineBound,bound,cells,entropy,fibonacci,fragmentation,goldenAngle,goldenRanks,improvement,label,nodes,paddingBytes,payloadBytes,phi,spanBytes,withinBound,writes";

        // Fase 1 — autopoiesis, mutador y puerta ZK.
        let informe = serde_json::to_value(autopoiesis(DOCUMENTO)).expect("autopoiesis serializa");
        assert_eq!(
            claves(&informe),
            "axioms,certified,contradictions,gate,generation,roots,unknownRoots,verdict"
        );
        assert_eq!(
            claves(&informe["axioms"][0]),
            "generation,root,rule,tolerated,valence"
        );
        assert_eq!(
            claves(&informe["gate"]),
            "challenge,checks,commitments,constraints,label,publicInputs,summary,verified"
        );
        if let Some(chequeo) = informe["gate"]["checks"]
            .as_array()
            .and_then(|chequeos| chequeos.first())
        {
            assert_eq!(claves(chequeo), "name,passed");
        }
        assert!(informe["unknownRoots"].is_array());
        assert!(informe["certified"].is_boolean());
        assert!(informe["verdict"].is_string());

        // Fase 2 — banco cuántico nativo.
        let cuantico =
            serde_json::to_value(quantum_register(DOCUMENTO)).expect("cuantico serializa");
        assert_eq!(
            claves(&cuantico),
            "bell,bindings,collapses,entropyBits,label,phases,qubits,register"
        );
        assert_eq!(
            cuantico["qubits"].as_u64(),
            cuantico["register"]
                .as_array()
                .map(|registro| registro.len() as u64)
        );
        assert_eq!(
            claves(&cuantico["register"][0]),
            "amplitudes,basis,dim,entangledWith,entropyBits,measured,measurements,name,outcome,probabilities,topProbability,valence"
        );
        assert_eq!(
            claves(&cuantico["register"][0]["amplitudes"][0]),
            "im,label,magnitude,phase,probability,re"
        );
        assert_eq!(
            claves(&cuantico["bindings"][0]),
            "correlation,epoch,joint,label,left,meaning,phase,right,strength,valence"
        );
        assert_eq!(
            claves(&cuantico["bell"][0]),
            "correlation,joint,meaning,phase"
        );

        // Fase 2 — malla holográfica.
        let malla =
            serde_json::to_value(mesh_status(DOCUMENTO, 3, 2, false)).expect("malla serializa");
        assert_eq!(
            claves(&malla),
            "conflicts,converged,deliveries,digest,drift,entries,epoch,label,merged,micros,nodes,noop,peers,rounds,stale,threaded,wireBytes"
        );
        assert_eq!(
            claves(&malla["nodes"][0]),
            "applied,clock,entries,epoch,hologram,id,name,rejected"
        );

        // Fase 2 — Metal‑IR y bypass del driver.
        let metal = serde_json::to_value(metal_program(DOCUMENTO, "gpu")).expect("metal serializa");
        assert_eq!(
            claves(&metal),
            "allocated,avoidedSyscalls,barriers,bypass,bypassedSyscalls,capacity,descriptor,device,deviceLabel,dispatch,dispatchCycles,dispatchLanes,dispatchOccupancy,instructions,label,lanes,latencySavedNs,layoutBytes,mmioBase,occupancy,ops,pressure,ranges,registers,ringEntries,signature,spillBytes,spilled,truncated,waves,wordCount,words"
        );
        assert_eq!(
            claves(&metal["instructions"][0]),
            "barrier,cycles,describe,dst,imm,laneMask,lanes,latency,opcode,origin,src,word"
        );
        assert_eq!(
            claves(&metal["registers"][0]),
            "alignment,bankBytes,class,glyph,label,masking,ratio,slots,used,width"
        );

        // Fase 2 — control temporal `Δ⁻¹` (el diario puede venir vacío).
        let linea = serde_json::to_value(timeline(DOCUMENTO)).expect("timeline serializa");
        assert_eq!(
            claves(&linea),
            "deltas,depth,label,live,nextMarker,paradox,reverted,stack,top,topLabel,total,truncated"
        );
        if let Some(delta) = linea["deltas"].as_array().and_then(|deltas| deltas.first()) {
            assert_eq!(claves(delta), "atMicros,id,inverse,kind,label,reverted");
        }
        assert!(
            linea["top"].is_null() || linea["top"]["key"].is_string(),
            "la valencia de la cumbre la publica el kernel"
        );

        // Fase 3 — geometría áurea: la del documento y la de un plan puro.
        let fractal = serde_json::to_value(fractal_memory(DOCUMENTO)).expect("fractal serializa");
        assert_eq!(claves(&fractal), CONTRATO_FRACTAL);
        assert!(fractal["cells"].is_array());
        let plan = serde_json::to_value(fractal_plan(&[64, 96, 160])).expect("plan serializa");
        assert_eq!(plan["nodes"], 3);
        assert_eq!(claves(&plan), CONTRATO_FRACTAL);
        assert_eq!(
            claves(&plan["cells"][0]),
            "affinity,bytes,key,label,rank,slot,stride"
        );
    }
}

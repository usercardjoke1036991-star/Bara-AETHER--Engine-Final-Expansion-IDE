# Inventario funcional — Workspace Bara

**Repositorios cubiertos**

| Ruta | Qué es | Crate(s) |
|---|---|---|
| `C:\Users\Vexor\Downloads\BAR` | Kernel del lenguaje Bara (AETHER‑Ω, `v0.1.0-kernel`) | `bara` (lib + 2 bin) |
| `C:\Users\Vexor\Downloads\bara-ide` | IDE de escritorio: motor, backend Tauri e interfaz React | `bara-ide` (lib + bin), `bara-ide-desktop` (src-tauri) |
| `C:\Users\Vexor\Downloads\Cargo.toml` | Workspace Cargo contenedor | miembros: `BAR`, `bara-ide`, `bara-ide/src-tauri` |

**Naturaleza del documento:** inventario de reconocimiento de **solo lectura** (12/10/2026). No se modificó código
para producirlo: los símbolos se extrajeron con volcados (`findstr`/`Select-String`) sobre los fuentes reales, de modo
que **todo lo que aparece aquí existe en el árbol** con el nombre exacto que figura en él.

---

## 0. Cómo leer este documento

* **Capas (A–F)**: cada capa es un conjunto de ficheros con un rol distinto (motor, backend, interfaz, kernel, scripts, configuración).
* Las listas de funciones/tipos son **la API pública real** de cada módulo (más algunos detalles de uso visible: clases de *token*, meta‑comandos, intenciones, valencias).
* Cuando un dato procede de código y de un README a la vez y **discrepan**, se indica (p. ej. el recuento de pruebas).
* Convención de rutas: relativas al repositorio correspondiente.

---

## 1. Qué es (visión general)

**Bara IDE** es la aplicación de escritorio del **lenguaje Bara** (*shoresh* `בָּרָא`, «creó»), un lenguaje
**trascendental** donde los programas se escriben con **raíces triconsonánticas hebreas** y se evalúan sobre un
runtime **paraconsistente/autopoiético** (lógica de Belnap: la contradicción se **tolera**, jamás explota).

* El **kernel** (crate `bara`, en el repo `BAR`) es Rust puro: **solo `std`**, cero dependencias, cero `unsafe`, **totalidad garantizada** (ninguna entrada provoca pánico).
* El **IDE** envuelve el kernel y **no reimplementa nada**: ni un glifo hebreo está escrito a mano en TypeScript; el catálogo de raíces, la biláttice de Belnap y el oráculo salen literalmente del kernel.
* El flujo de datos es de **una sola dirección**:

```
web/ (React 19 + TS + Vite 7)  ──IPC──▶  src-tauri/ (Tauri v2 · 14 comandos)
        interfaz gráfica                      │
                                              ▼
                                 bara-ide (lib/CLI · modelo serializable)
                                              │  bara = { path = "../BAR" }
                                              ▼
                                 bara (kernel · lexer + runtime congelados)
```

**Idea de diseño:** el IDE es un *visor* del kernel. Si el kernel cambia, el IDE cambia; si el kernel se equivoca,
el IDE enseña el error del kernel y no uno propio.

---

## 2. Mapa del workspace

### 2.1 Capas

| Capa | Ámbito | Qué contiene |
|---|---|---|
| **A** | `bara-ide/src` | Motor del IDE: modelo serializable + CLI histórica (`bara-ide`) |
| **B** | `bara-ide/src-tauri` | Backend Tauri v2 (`bara-ide-desktop`): 14 comandos IPC + build.rs + scripts de toolchain GNU |
| **C** | `bara-ide/web/src` | Interfaz React/TypeScript (ventana, editor, tabla de tokens, panel de IA) |
| **D** | `bara-ide/web/scripts` | Autodiagnóstico en Node (`ai-check.mjs`) |
| **E** | `BAR/src` | Kernel `bara`: 11 módulos + 2 binarios |
| **F** | `BAR/` (raíz) | Manifiesto de ejemplo, scripts de CI, tests, workflows, configuración Cargo |

### 2.2 Árbol de ficheros

```
C:\Users\Vexor\Downloads\
├── Cargo.toml                         workspace: miembros BAR, bara-ide, bara-ide/src-tauri (+ perfil release)
│
├── BAR\                               KERNEL  (bara v0.1.0-kernel)
│   ├── Cargo.toml  Cargo.lock  README.md  LICENSE
│   ├── .cargo\config.toml
│   ├── .github\
│   │   ├── workflows\ci.yml
│   │   └── main-protection.json
│   ├── manifests\shoresh_manifest.bara
│   ├── scripts\
│   │   ├── check_profiles.ps1
│   │   └── ci_status.ps1
│   ├── src\
│   │   ├── lib.rs            (10 `pub mod` + 4 reexportaciones)
│   │   ├── main.rs           bin `bara` (programa génesis, 13 fases)
│   │   ├── bin\bara_oracle.rs bin `bara_oracle` (REPL interactivo)
│   │   ├── lexer.rs          (388)
│   │   ├── runtime.rs        (1131)
│   │   ├── memory_region.rs  (290)
│   │   ├── zk_proof.rs       (482)
│   │   ├── ffi_ingest.rs     (273)
│   │   ├── temporal_rollback.rs (380)
│   │   ├── quantum_native.rs (955)
│   │   ├── mesh_sync.rs      (1053)
│   │   ├── metal_ir.rs       (949)
│   │   └── repl.rs           (859)
│   └── tests\
│       ├── integration_suite.rs (1412)
│       └── stress_test.rs       (596)
│
└── bara-ide\                          IDE
    ├── Cargo.toml  package.json  package-lock.json
    ├── vite.config.ts  tsconfig.json  README.md  .env.example  .gitignore
    ├── docs\INVENTARIO.md             (este documento)
    ├── samples\genesis.bara
    ├── src\
    │   ├── lib.rs   (1408)   motor: tipos + informes + 18 pruebas
    │   └── main.rs  (101)    CLI `bara-ide`
    ├── src-tauri\
    │   ├── Cargo.toml  tauri.conf.json  build.rs (190)
    │   ├── capabilities\default.json
    │   ├── icons\  (32/128/256/512.png, icon.ico, icon.icns)
    │   ├── .cargo\config.toml         [sin commitear] runner GNU
    │   ├── scripts\                   [sin commitear]
    │   │   ├── win-gnu-runner.py   (48)
    │   │   └── win-gnu-recursos.py (389)
    │   └── src\{lib.rs (176), main.rs (13)}
    └── web\
        ├── index.html
        ├── scripts\ai-check.mjs  (40)
        └── src\
            ├── main.tsx (17)  App.tsx  engine.ts  styles.css  vite-env.d.ts
            ├── ai\{types.ts (78), config.ts (241), images.ts (202),
            │       prompt.ts (129), providers.ts (338), selfcheck.ts (429)}
            └── components\{ChatPanel.tsx (543), AiSettings.tsx (229),
                            AssistantText.tsx (146)}
```

**Métricas:** 1887 líneas de Rust en `bara-ide/src` + `src-tauri/src` + `build.rs`; kernel ≈ 7 900 líneas de
código y ≈ 2 000 de pruebas.

---

## 3. Capa E/F — Kernel `bara` (`BAR`)

### 3.1 Los 11 módulos y toda su API pública

#### `lexer.rs` — análisis léxico triconsonántico (388 líneas)
| Elemento | Detalle |
|---|---|
| `enum Keyword` | `Manifest` (`ברא` manifestar/creación ex nihilo) · `Guard` (`שמר` guardar/aislamiento de día‑cero) · `Synthesize` (`חכם` sintetizar/heurística adaptativa) · `Execute` (`עבד` ejecutar/colapso) · `Emit` (`אמר` emitir/enunciar) · `Judge` (`שפט` juzgar/evaluación lógica) |
| métodos | `from_root(root) -> Option<Keyword>` · `glyph() -> &'static str` · `meaning() -> &'static str` |
| `enum TokenKind` | 16 clases: `Root{letters, keyword}` · `Identifier(String)` · `Number(f64)` · `Str(String)` · `Colon` `:` · `Semicolon` `;` · `Comma` `,` · `Arrow` `->` · `Plus` `+` (disyunción paraconsistente) · `Star` `*` (conjunción) · `Bang` `!` (colapso/observación) · `BangBang` `!!` (fusión paraconsistente) · `Question` `?` (observación heurística) · `Punct(char)` (cualquier otro símbolo, **preservado sin juicio**) · `Newline` · `Eof` |
| `struct Token` | glifo, semántica, ubicación física (línea/columna) · `keyword()` |
| `struct Lexer` | `new(source)`, `tokenize()` |

#### `runtime.rs` — estado cuántico, memoria holográfica y ejecución (1131 líneas)
| Elemento | Detalle |
|---|---|
| `enum Observation` | las 4 valencias de Belnap: `True` (⊤) · `False` (⊥) · `Both` (**contradicción tolerada**) · `Neither` (indeterminado) · `glyph()`, `name()` |
| `enum QuantumState` | `Classical(bool)`, superposición, paraconsistente · `classical`, `superposition(α,β)`, `paraconsistent(truth,falsity)`, `truth_mass`, `falsity_mass`, `belnap() -> (f64,f64)`, `observe`, `is_contradiction`, `negate`, `conjunction`, `disjunction`, `is_classical`, `label` |
| `struct Axiom` | axioma nacido por autopoiesis |
| `struct AutopoieticMutator` | `new`, `generation`, `knows(root)`, `axiom(root)`, `axioms()`, `synthesize(root)` |
| `struct MemoryNode` | celda de la memoria holográfica |
| `struct HolographicMemory` | `new`, `len`, `is_empty`, `writes`, `entropy`, `store(label,state)`, `recall(label)`, `recall_by_key(key)`, `nodes()`, `topological_affinity_to(a,b)` |
| `enum ExecutionEvent` | eventos del log ontológico (cada variante describe su significado) · `describe()` |
| `struct BaraRuntime` | `new`, `log()`, `push(state)`, `pop()`, `peek()`, `certify()` (ZK del AST), `ingest_c(source)`, `ingest_python(source)`, `note(event)`, `superpose_native(...)`, `entangle_native(...)`, `collapse_native(name)`, `mesh_sync(peers, rounds, threaded)`, `lower_metal(label, device, tokens)`, `execute(tokens)` |

#### `memory_region.rs` — inferencia de regiones zero‑copy CPU/GPU (290 líneas)
`RegionId(pub usize)` · `RegionKind` + `label`,`glyph` · `Device` + `label` · `Region` · `ZeroCopyHandle` · `Access` ·
`RegionPlan` · `RegionTable` + `new`, `introduce`, `get`, `regions`, `len`, `is_empty`, `total_bytes`, `max_depth`,
`depth_of`, `contains`, `share` · `RegionAnalyzer::infer(accesses) -> RegionPlan`

#### `zk_proof.rs` — verificación ZK‑SNARK del AST (482 líneas)
`const P` (primo de referencia) · `Fp(pub u64)` + `new`, `pow`, `inv`, `is_zero` · `Poly` + `zero`, `constant`,
`is_zero`, `degree`, `eval`, `add`, `sub`, `mul`, `vanishing`, `commit` · `Statement` · `ConstraintSystem` +
`from_invariants`, `statement` · `ZkEvals` · `Proof` · `VerifyResult` · `fn prove(system, statement)` ·
`fn verify(statement, proof)` · `ZkCertificate::certify(system, statement)`

#### `ffi_ingest.rs` — ingesta omnívora de legado C/Python (273 líneas)
`LegacyLang` + `label` · `Param` · `IngestedDecl` · `BaraType` + `label`, `glyph`, `from_legacy(ctype)` ·
`ShoreshNode` · `ShoreshAst` + `hazard_score`, `sanitized_count`, `roots()` · `fn root_from_name(name)` ·
`fn hazard_of(text)` · `fn sanitize(decl) -> (f64, QuantumState, bool)` · `fn to_shoresh(decls)` ·
`fn ingest_c(source) -> Vec<IngestedDecl>` · `fn ingest_python(source) -> Vec<IngestedDecl>`

#### `temporal_rollback.rs` — navegación temporal y `Δ⁻¹` (380 líneas)
`Marker(pub u64)` · `DeltaKind` + `inverse_label` · `Delta` + `inv_label` · `RollbackReport` · `Paradox` ·
`fn detect_paradox(state) -> Option<Paradox>` · `TemporalEngine` + `new`, `now_micros`, `stack()`, `deltas()`,
`mark()`, `push(state)`, `pop()`, `replace(after)`, `perform(kind, label)`, `rollback_to(marker)`,
`rollback_paradox(marker, &paradox)`

#### `quantum_native.rs` — tipos cuánticos nativos `Qubit<|ψ⟩>` (955 líneas)
* `Amplitude` + `from_polar`, `add`, `sub`, `mul`, `scale`, `conj`, `norm_sqr`, `modulus`, `phase`, `is_zero`, `label`
* `BasisState` + `new`, `dirac(index)`
* `AmplitudeVector` + `new`, `uniform(dim)`, `from_index`, `dim`, `norm`, `normalized`, `probabilities`,
  `amplitude_of`, `entropy_bits`, `top_probability`, `argmax`, `measurement_index(seed)`, `interfere(other,θ)`,
  `tensor(other)`, `partial_trace_left()`
* `BellPhase` (4 fases de Bell) + `all`, `label`, `meaning`, `correlation`, `joint`, `correlated_index(local)`
* `EntanglementBinding` + `label`, `involves(name)`, `partner(name)`, `joint()`
* `Qubit` + `new`, `pure`, `uniform`, `dim`, `is_measured`, `is_entangled`, `probabilities`, `entropy_bits`,
  `top_probability`, `outcome_label`, `phase_shift(θ)`, `hadamard()`, `valence() -> QuantumState`, `describe()`
* `QuantumEvaluation` + `label` · `QuantumNative` + `new`, `len`, `is_empty`, `collapses`, `bindings`, `names`,
  `get(name)`, `partners_of(name)`, `materialize(name, vector)`, `superpose`, `uniform`, `evaluate`, `hadamard`,
  `phase_shift`, `entangle`, `collapse(name)`, `global_valence()`

#### `mesh_sync.rs` — malla global de memoria holográfica (1053 líneas)
* `PeerId(pub usize)` + `label`
* `VectorClock` + `new(peers)`, `len`, `is_empty`, `get`, `tick`, `set`, `merge`, `dominated_by`,
  `happens_before`, `concurrent_with`, `total`, `label`
* `MeshEntry` + `new(name, region, state, epoch)`, `matches`, `merge_with`
* `MeshFrame` + `new(origin, epoch, clock, entries)`, `len`, `is_empty`, `revisions`, **`to_wire() -> Vec<u8>`**,
  **`from_wire(bytes) -> Option<MeshFrame>`**
* `fn hologram_of(entries)` · `fn fingerprint(state)`
* `IngestOutcome` · `MeshNode` + `new`, `len`, `is_empty`, `epoch`, `clock`, `applied`, `rejected`, `entries`, `get`,
  `hologram`, `insert`, `advance`, `snapshot`, `ingest(frame)`
* `RouteReport` · `MeshBus` + `new`, `enqueue`, `pending`, `delivered`, `dropped`, `route(&mut [MeshNode])`
* `SyncReport` + `label`
* `MeshCluster` + `new(peers)`, `nodes`, `node`, `len`, `is_empty`, `epoch`, `wire_bytes`, `entries`, `seed`,
  `diverge`, `hologram`, `converged`, `drift`, **`synchronize(rounds)`**, **`synchronize_threaded(rounds)`**

#### `metal_ir.rs` — mapeo de registros y bypass del driver (949 líneas)
* `RegisterClass` (5 clases) + `all`, `label`, `glyph`, `bank`, `slots`
* `RegisterBank` + `bytes`, `label` · `const LAYOUT: [RegisterBank; 5]` · `fn capacity()`, `fn layout_bytes()`
* `PhysicalReg` + `label` · `LiveRange` + `span` · `RegAllocation` (asignador) + `allocate(ranges)`, `physical`,
  `allocated`, `spilled`, `spill_bytes`, `pressure`, `occupancy`, `usage(class)`, `bank_usage()`
* `MetalOpcode` (14 opcodes) + `all`, `label`, `code`, `dst_class`, `latency`, `is_barrier`
* `Operand` + `index`, `label` · `MetalOp` + `lane_mask`, `encode`, `describe`
* `DriverBypass` + `from_words`, `label` · `DispatchReport` + `label`
* `MetalProgram` + `words`, `len`, `is_empty`, `descriptor`, `lanes`, `barriers`, `physical_of`, `signature`,
  `dispatch()`
* `MetalMapper::lower(label, device, tokens) -> MetalProgram`

#### `repl.rs` — oráculo interactivo con monitor `Δ⁻¹` (859 líneas)
| Elemento | Detalle |
|---|---|
| `enum MetaCommand` | `Help`, `Status`, `Memory`, `Timeline`, `Quantum`, `Mesh`, `Metal`, `Zk`, `Undo`, `Quit`, `Unknown(String)` (tolerado) · `parse(raw)` (alias bilingües, acentos plegados) · `name()` |
| alias | `help`/`ayuda`/`?` · `status`/`estado` · `mem`/`memory`/`memoria` · `time`/`timeline`/`tiempo`/`delta` · `q`/`quantum`/`cuantica`/`qubits` · `mesh`/`malla` · `metal`/`ir`/`hardware` · `zk`/`proof`/`prueba` · `undo`/`deshacer`/`rollback` · `quit`/`exit`/`salir`/`q!` |
| `enum Intent` | `Roots(String)` → etiqueta `"shoresh"` · `Meta(MetaCommand)` → `"meta:<nombre>"` · `Empty` → `"silencio"` |
| `struct OracleTurn` | `input`, `intent`, `roots`, `reply`, `events`, `micros` (**no determinista**: reloj de pared, informativo), `axioms`, `monitor` · `describe()` |
| `struct OracleReport` | `turns`, `events`, `rollbacks`, `synthesized`, `micros`, `roots` · `label()` |
| funciones libres | `hebrew_roots(text)`, `natural_to_roots(text) -> (String, Vec<String>, usize)`, `manifest_lines(source)`, `interactive_available()` |
| `struct Oracle<'a>` | `new(&mut BaraRuntime)`, `mark_interactive`, `interactive_session`, `turns()`, `interpret(input)`, **`converse(input)`**, `report()`, `run_script(&[&str])`, `run_manifest(source)`, `run()` |

#### `lib.rs` (raíz del kernel)
10 módulos públicos (`ffi_ingest`, `lexer`, `memory_region`, `mesh_sync`, `metal_ir`, `quantum_native`, `repl`,
`runtime`, `temporal_rollback`, `zk_proof`) + 4 reexportaciones de conveniencia:
`memory_region::{Device, RegionId, RegionKind}`, `quantum_native::{Amplitude, BellPhase}`,
`repl::{manifest_lines, MetaCommand, Oracle, OracleReport}`,
`runtime::{BaraRuntime, ExecutionEvent, Observation, QuantumState}`.

### 3.2 Binarios y CLI

| Binario | Fichero | Comportamiento |
|---|---|---|
| `bara` | `src/main.rs` | Ejecuta el **programa génesis** (`GENESIS_SOURCE`: `ברא`, `חכם`, `עבד`, `ברא`, `ברא`, `!!`, `עבד`, `שמר`, `נצח`, `עבד`, `אמר`, `שפט`, `אמר`) y emite el **log ontológico**. Si la entrada es un terminal real, entra además en el oráculo. Constante interna `GENESIS_SOURCE`. |
| `bara` | idem | `bara --oracle` — **fuerza** el bucle interactivo aunque la entrada esté redirigida (guiones / CI). |
| `bara_oracle` | `src/bin/bara_oracle.rs` (55) | REPL del oráculo: 10 meta‑comandos, turnos, `Δ⁻¹`, informe. |

### 3.3 Las 13 fases del génesis (orden exacto)

1. Análisis léxico triconsonántico.
2. Ejecución ontológica (log del génesis).
3. Autopsia del núcleo (**autopoiesis**).
4. Memoria holográfica de **entropía cero**.
5. Tensión paraconsistente (demostración de **no‑explosión**).
6. Inferencia de regiones de memoria (**zero‑copy** CPU/GPU).
7. Verificación **ZK‑SNARK** del AST (etapa de compilación).
8. Ingesta **FFI** omnívora (legado C/Python → *Shoresh* AST).
9. Navegación temporal y **rollback `Δ⁻¹`**.
10. Tipos cuánticos nativos (`Qubit<|ψ⟩>`) y entrelazamiento.
11. Malla global de memoria holográfica (bus e hilos `std`).
12. **Metal‑IR**: mapeo de registros y bypass del driver.
13. Oráculo **REPL** interactivo con monitor `Δ⁻¹`.

### 3.4 Pruebas y guardas de calidad (Capa F)

* `tests/integration_suite.rs` (1412 líneas) + `tests/stress_test.rs` (596 líneas) = **40 pruebas** (30 + 10) según el README del kernel.
* Guardas declaradas: **grep de totalidad** (sin `expect`/`unwrap` en `src`), `scripts/check_profiles.ps1` (perfiles), `cargo fmt`, `cargo clippy`, `.github/workflows/ci.yml` (5 verificaciones) y `.github/main-protection.json`.
* `manifests/shoresh_manifest.bara` — manifiesto de ejemplo en raíces *Shoresh* que consume `Oracle::run_manifest`.

---

## 4. Capa A — Motor del IDE (`bara-ide`, `src/lib.rs` + `src/main.rs`)

Proyecta el lexer/oráculo del kernel a un **modelo serializable** (`Analysis`) que viaja por IPC. Reexporta el
vocabulario del kernel: `pub use bara::lexer::{Keyword, Lexer, Token, TokenKind}`.

### 4.1 Constantes y tipos

| Símbolo | Qué es |
|---|---|
| `const VERSION` | `env!("CARGO_PKG_VERSION")` |
| `const SAMPLE_GENESIS` | `include_str!("../samples/genesis.bara")` (el documento de ejemplo va **dentro** del binario) |
| `const KEYWORDS: [Keyword; 6]` | las seis raíces semánticas del kernel, en orden canónico |
| `const BILATTICE_CORNERS: [(f64,f64); 4]` | `(1,0) (0,1) (1,1) (0,0)` — esquinas de la biláttice |
| `enum TokenClass` + `label()` | clase léxica simplificada para la interfaz |
| `struct TokenInfo` | lexema, glifo, semántica, línea/columna, `display` |
| `struct Summary` | total, raíces conocidas/desconocidas, identificadores, números, cadenas, símbolos, saltos, EOF |
| `struct RootUsage`, `struct RootEntry` | uso de raíz en el documento; entrada del catálogo (glifo + significado) |
| `struct Analysis` | documento completo: fuente, `sourceChars`, `sourceLines`, tokens, resumen, inventario de raíces |
| `enum ReportMode` | modos del informe de texto (`--tokens` / `--summary`, etc.) |
| `struct Translation` | `program`, `roots`, `synthesized` (raíces que hubo que sintetizar) |
| `struct ObservationView` + `project(Observation)` | proyección de las 4 valencias de Belnap |
| `struct BelnapPoint` + `project(QuantumState)` | punto `(truth, falsity)` con clave, negación y contradicción |
| `struct BelnapLattice` | tablas `∧`, `∨` y negación completas |
| `struct BelnapEvaluation` | evaluación de un par `(truth, falsity)` con su negación |
| `struct TurnView` + `project(&OracleTurn)` | turno del oráculo proyectado |
| `struct DeltaView` + `project(&Delta)` | entrada del diario temporal `Δ⁻¹` |
| `struct RollbackView` + `project(marker, &RollbackReport)` | resultado de un rollback |
| `struct SessionStatus` | informe de sesión (pilas, diario, memoria, mutador, malla) |
| `struct TurnResult` | resultado devuelto por cada comando conversacional |
| `struct Session` | **sesión viva** del oráculo (envoltura del `Oracle` del kernel) |
| `struct Replayed` (privado) | estado reproducible de la sesión (para determinismo) |

### 4.2 Funciones públicas

| Función | Qué hace |
|---|---|
| `analyze(source) -> Analysis` | ejecuta el lexer del kernel y proyecta el resultado (nunca falla: el lexer es total) |
| `catalogue() -> Vec<RootEntry>` | catálogo de las 6 raíces del kernel (glifo + significado) |
| `translate(text) -> Translation` | llamada al traductor del **REPL del kernel** (`natural_to_roots`) |
| `read_source_file(path) -> Result<String, String>` | lee un `.bara` con error legible (`"no se pudo leer…"`) |
| `render_report(&Analysis, origin, ReportMode) -> String` | informe de texto para la CLI |
| `belnap_values() -> Vec<BelnapPoint>` | los 4 puntos de la biláttice |
| `belnap_lattice() -> BelnapLattice` | las tablas completas, calculadas por el kernel |
| `belnap_evaluate(truth, falsity) -> BelnapEvaluation` | evalúa un par de masas y su negación |

Privadas/respaldo: `token_class`, `lexeme`, `describe`, `summarize`, `inventory`, `key_of`, `corner_states`,
`saturate`, los cinco `project(...)`, y los métodos internos `Session::snapshot` / `Session::replay`.

### 4.3 `Session` (API del oráculo para la interfaz)

`new()` · `script() -> &[String]` · `applied_rollbacks() -> &[u64]` · `is_empty()` · `reset()` ·
`converse(input) -> TurnResult` · `rollback(marker) -> TurnResult` · `status() -> SessionStatus` ·
`turns() -> Vec<TurnView>` · `deltas() -> Vec<DeltaView>` (+ privados `snapshot`, `replay`).

### 4.4 CLI `bara-ide` (`src/main.rs`, 101 líneas)

`USAGE` con modos: `--tokens` · `--summary` · `--help`/`-h` · `--version`/`-V`; entrada por argumento de ruta o por
`stdin` (`read_source`). Comparte el modelo y los informes con el backend (una sola fuente de verdad).

### 4.5 Pruebas del motor (18 `#[test]`, no 11 como dice el README)

`el_oraculo_y_la_bilattice_serializan_con_el_contrato_de_la_interfaz` ·
`el_oraculo_de_la_sesion_usa_el_pipeline_del_kernel` · `la_sesion_es_determinista_y_el_rollback_idempotente` ·
`el_estado_de_la_sesion_no_retrocede` · `las_cuatro_valencias_de_belnap_son_las_del_kernel` ·
`la_bilattice_la_calcula_el_kernel_entera` · `evaluar_un_par_recorta_las_masas_como_el_kernel` ·
`la_entrada_vacia_solo_produce_el_centinela` · `reconoce_una_raiz_conocida_con_su_glifo` ·
`una_raiz_desconocida_no_es_un_error` · `clasifica_un_documento_completo` · `el_informe_de_texto_respeta_los_modos` ·
`el_catalogo_viene_del_kernel` · `el_documento_de_ejemplo_es_analizable` · `cualquier_entrada_es_tolerada` ·
`el_lexicon_del_kernel_traduce_lengua_natural` · `leer_un_archivo_inexistente_da_error_legible` ·
`el_modelo_serializa_con_el_contrato_de_la_interfaz` (esta última es la que fija el contrato IPC con `engine.ts`).

Ayudantes internos: `assert_counts_consistent`, `firma`.

---

## 5. Capa B — Backend Tauri (`bara-ide/src-tauri`, crate `bara-ide-desktop`)

### 5.1 Los 14 comandos IPC (`src/lib.rs`, 176 líneas)

| # | Comando | Firma |
|---|---|---|
| 1 | `analyze_source` | `(source: String) -> Analysis` |
| 2 | `analyze_file` | `(path: String) -> Result<Analysis, String>` |
| 3 | `kernel_catalogue` | `() -> Vec<RootEntry>` |
| 4 | `sample_genesis` | `() -> String` |
| 5 | `shoresh_translate` | `(text: String) -> Translation` |
| 6 | `read_document` | `(path: String) -> Result<String, String>` |
| 7 | `oracle_converse` | `(input: String, state) -> Result<TurnResult, String>` |
| 8 | `oracle_status` | `(state: State<'_, Mutex<Session>>) -> Result<SessionStatus, String>` |
| 9 | `oracle_turns` | `(state) -> Result<Vec<TurnView>, String>` |
| 10 | `oracle_reset` | `(state) -> Result<SessionStatus, String>` |
| 11 | `temporal_deltas` | `(state) -> Result<Vec<DeltaView>, String>` |
| 12 | `temporal_rollback` | `(marker, state) -> Result<TurnResult, String>` |
| 13 | `belnap_lattice` | `() -> BelnapLattice` |
| 14 | `belnap_evaluate` | `(truth: f64, falsity: f64) -> BelnapEvaluation` |

Además: `fn with_session<T>(...)` (ayudante que resuelve el `Mutex<Session>` y traduce los fallos a errores legibles)
y `pub fn run()` (arranque de la aplicación Tauri, invocado desde `src/main.rs`, 13 líneas).

### 5.2 `build.rs` (190 líneas) — recursos de Windows sin pánicos

* Constantes `COMPILADORES_WINDRES: [&str; 3]` = `windres.exe`, `llvm-windres.exe`, `x86_64-w64-mingw32-windres.exe`;
  `RAICES_MINGW: [&str; 4]` = `C:\msys64\mingw64\bin`, `C:\msys64\ucrt64\bin`, `C:\mingw64\bin`, `C:\MinGW\bin`.
* Funciones: `compilador_indicado_por_entorno()` (respeta `RC`, `RC_<TARGET>`, `RC_<TARGET_CON_GUIONES>`),
  `buscar_windres()`, `directorio_de_perfil()` / `ruta_del_ejecutable()`, `lanzar_parcheador(exe)`, `main()`.
* En toolchain **GNU**: publica `cargo:rustc-link-arg=-Wl,--exclude-all-symbols` para evitar
  `ld: error: export ordinal too large: 95834` (la plantilla de Tauri v2 declara `cdylib` y `ld` de MinGW exporta
  todos los símbolos automáticamente; el `.exe` del IDE enlaza la `rlib` y no exporta nada).
* Si **no** hay compilador de recursos: pide a `tauri-build` un icono inexistente para que falle **antes** de invocar
  el compilador ausente, degrada ese único paso a `cargo:warning` (sin pánico: `cargo check` sigue siendo válido) y
  deja un proceso suelto (`cmd /C start … python win-gnu-recursos.py --exe … --wait 900`) que parchea el `.exe` **en
  cuanto el enlazador lo escribe**.
* Motivo (documentado en el propio fichero): sin manifiesto no hay contexto Side‑by‑Side y `comctl32` se resuelve
  contra el 5.82 de System32, que **no exporta** `TaskDialogIndirect` → el arranque muere con
  `0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND`; sin `RT_GROUP_ICON`, `tao` falla con `0x80070715`.

### 5.3 Scripts del toolchain GNU (versionados en `main`)

> **Hallazgo verificado empíricamente:** Cargo **no** resuelve la ruta del `runner` contra el `config.toml`, sino
> contra el **directorio de trabajo** desde el que se invoca `cargo`. Prueba: con `runner = ["python",
> "scripts/win-gnu-runner.py"]` funciona desde `src-tauri\` pero falla desde `src-tauri\scripts\` (`can't open file
> '…\src-tauri\scripts\scripts\win-gnu-runner.py'`, exit 2). Por eso la ruta va **absoluta** y el fichero documenta las
> dos vías para portarla a otra máquina.

| Fichero | Contenido |
|---|---|
| `.cargo/config.toml` | `[target.x86_64-pc-windows-gnu] runner = ["python", "…\\scripts\\win-gnu-runner.py"]` |
| `scripts/win-gnu-runner.py` (48) | Runner de cargo: si el binario es `bara-ide-desktop.exe` (`NOMBRE_APP`) lo parchea llamando a `win-gnu-recursos.py --exe …` (con aviso si falla) y después lo ejecuta con `subprocess.call` — el mismo camino (`CreateProcess`) que usan `cargo` y `tauri`. Los demás binarios (pruebas, ejemplos, `bench`) se ejecutan sin tocar nada. |
| `scripts/win-gnu-recursos.py` (389) | Embebe los recursos que `windres` habría puesto, **solo con `ctypes`** y de forma **idempotente**: `RT_MANIFEST` (id 1) con la dependencia **Common‑Controls 6.0.0.0**; `RT_ICON` + `RT_GROUP_ICON` desde `icons/icon.ico`, con el grupo en dos ids — `1` (icono “principal” del `.exe`, el del Explorador) y `32512 = ID_ICONO_APP` (`tauri_utils` lo busca para el icono de ventana); **copia `WebView2Loader.dll`** junto al `.exe` (en MSVC va estático). Funciones clave: `leer_ico()` (ICO multi‑tamaño), `embebe_recursos()` (`BeginUpdateResourceW` / `UpdateResourceW` / `EndUpdateResourceW`), `_existe_recurso()` (`LoadLibraryExW` con `LOAD_LIBRARY_AS_DATAFILE` + `FindResourceW`, sin ejecutar nada). Uso: `--exe RUTA [--forzar]`, `--wait 900` (espera al enlace) y `--probar 20` (prueba de humo: lanza y mide segundos de supervivencia). |

---

## 6. Capa C/D — Interfaz React (`bara-ide/web`)

React 19 + TypeScript 5 + Vite 7. Tres ficheros raíz (`main.tsx`, `App.tsx`, `engine.ts`), seis módulos en `ai/`
y tres componentes. **Regla de oro:** la interfaz no traduce ni reinterpreta el kernel; solo pinta lo que recibe.

### 6.1 `main.tsx` (17 líneas)
Monta el árbol React sobre `#root` (`const container = document.getElementById("root")`), importa `styles.css`.

### 6.2 `engine.ts` — cliente IPC tipado

* Importa `invoke` de `@tauri-apps/api/core` y declara los **tipos espejo** del Rust: `TokenClass`, `TokenInfo`,
  `Summary`, `RootUsage`, `RootEntry`, `Analysis`, `Translation`, `ObservationView`, `BelnapPoint`, `BelnapLattice`,
  `BelnapEvaluation`, `TurnView`, `DeltaView`, `RollbackView`, `SessionStatus`, `TurnResult`.
* `export const CLASS_LABEL: Record<TokenClass, string>` — etiquetas legibles por clase de *token* (lo que se ve en
  la columna «clase» de la tabla).
* **15 funciones**, una por comando (mismos argumentos en `camelCase` → claves del backend):
  `analyzeSource` → `analyze_source` · `analyzeFile` → `analyze_file` · `kernelCatalogue` → `kernel_catalogue` ·
  `sampleGenesis` → `sample_genesis` · `shoreshTranslate` → `shoresh_translate` · `readDocument` → `read_document` ·
  `oracleConverse` · `oracleStatus` · `oracleTurns` · `oracleReset` · `temporalDeltas` · `temporalRollback` ·
  `belnapLattice` · `belnapEvaluate` · más `describeError(error)` (convierte cualquier fallo en un texto legible).

### 6.3 `App.tsx` — ventana principal

* Raíz: `<div className={aiOpen ? "app ai-open" : "app"}>`; constante `MAX_ROWS = 1200` (tope de filas de la tabla de
  *tokens*).
* Componentes locales: `App()` (por defecto) y `SummaryPanel({ analysis })` (tabla de contadores del resumen).
* **Cabecera** (`header.bar`): título, `<span className="tag">kernel v0.1.0-kernel · Shoresh</span>` y
  `<span className="status">` que muestra `analizando…` mientras hay trabajo y, si no, el origen del documento.
  Si algo falla: banda `div.error`.
* **Rejilla de paneles** (`main.grid` → cuatro `section.pane`):

| Panel | Contenido |
|---|---|
| Editor | fila con ruta del documento (`input.path`), botón de apertura de fichero y `<textarea className="code">`; cada pulsación reanaliza (con rebote de ~200 ms) |
| Raíces | `<ul className="roots">` con `glyph` + `meaning` + `×count` del inventario del documento; si el documento está vacío, `Sin documento analizado.`, y `Ninguna raíz reconocida.` cuando corresponde; debajo, el catálogo del kernel (`kernel_catalogue`) |
| Oráculo | input de turno + último turno (`reply`, `roots` como `shoresh`, `×events`), `table.summary` con los contadores de `SessionStatus` (turnos, eventos, rollbacks, síntesis, memoria, mutador, malla…), y la **biláttice** (`<ul className="roots">` con `observation.glyph`, `observation.name` y las masas); mensajes de respaldo `Sesión del oráculo no disponible.` / `Sin biláttice servida por el kernel.` |
| *Tokens* (`section.pane.tokens`) | `div.scroll` con tabla: `line`, `column`, clase (`td.cls ${token.class}` con `CLASS_LABEL`), `lexeme` (el salto de línea se pinta `⏎`) y `display`/semántica |

* El panel de IA se abre con `aiOpen` (clase `ai-open` en la raíz) y se pinta en `ChatPanel`.

### 6.4 Componentes (`web/src/components`)

| Fichero | Qué expone |
|---|---|
| `ChatPanel.tsx` (543) | `ChatPanelProps` + `ChatPanel` (por defecto) + internos `MessageRow`, `TranslationBox`, `newId`, `reasonOf`. Pintado: `aside.ai-panel` (con estado `dragging`), `header.ai-head`, `div.ai-body`, `div.ai-log`, bienvenida `ai-welcome` + `describeConfig`, lista `ai-problems`, indicador `consultando al modelo…`, `form.ai-composer` (`textarea.code.ai-input`), chips de imágenes `ai-chips`/`ai-chip`(+`formatBytes`), zona de adjuntar `label.ai-attach`, `details.ai-report` con el **prompt del sistema** (con su recuento de caracteres) y otro con el **autodiagnóstico**; cada mensaje es `article.ai-msg.{user|assistant}` con `ai-msg-head` (nombre del modelo), miniaturas `ai-thumbs`, error `ai-error`; los bloques cercados se muestran en `div.ai-code` con `TranslationBox` («usar en el editor» → `shoresh_translate`). |
| `AiSettings.tsx` (229) | `AiSettings` (por defecto); `PROVIDERS: ProviderId[] = ["anthropic","openai"]`, `clamp`. Pintado: `div.ai-settings` con campos `label.ai-field` (proveedor, modelo, clave con `maskSecret` y `sin clave`, raíz de la API, `maxTokens` con `clamp`, temperatura), casillas `label.ai-check` (incluida la de enviar `max_completion_tokens` para modelos de razonamiento), lista `ai-problems`, `describeConfig`, `modelos: {status}` (resultado de `listModels`) y botones de acción. |
| `AssistantText.tsx` (146) | `Block`, `splitBlocks(markdown)` (separador de bloques cercados con `FENCE = /^\s*```([A-Za-z0-9_+-]*)\s*$/`), `codeBlocks(markdown)`, `AssistantText` (por defecto) + internos `renderInline`, `CodeBlock`. Pinta `div.ai-answer` con prosa `p.ai-text` y bloques `div.ai-code` (`ai-code-head` con el lenguaje y botón de copiar/usar, `pre.ai-code-body`); código en línea `inline-code`; `Sin respuesta.` si no hay nada. |

### 6.5 Panel de IA (`web/src/ai`, 1 417 líneas)

| Fichero | API pública |
|---|---|
| `types.ts` (78) | `ProviderId = "anthropic" \| "openai"` · `ChatRole = "user" \| "assistant"` · `ImageAttachment` · `ChatMessage` · `AiConfig` · `ChatUsage` · `ChatResult` · `ModelInfo` |
| `config.ts` (241) | `STORAGE_KEY = "bara-ide.ai.config.v1"` · `PROVIDER_ENDPOINTS` · `PROVIDER_LABELS` · `PROVIDER_ENV_KEYS` · `PROVIDER_MODEL_PRESETS` · `ANTHROPIC_VERSION = "2023-06-01"` · `ANTHROPIC_BROWSER_HEADER = "anthropic-dangerous-direct-browser-access"` · `DEFAULT_CONFIG` · `TOKEN_RANGE = {min:256,max:8192}` · `KeyValueStore` · funciones `defaultStore`, `envValue`, `envKeyFor`, `sanitizeConfig`, `loadStoredConfig`, `loadConfig`, `saveConfig`, `forgetConfig`, `withProvider`, `maskSecret`, `configProblems`, `describeConfig` |
| `prompt.ts` (129) | `MAX_DOCUMENT_CHARS = 4000` · `PromptContext` · `excerpt(source, max)`, `inventoryLine(analysis)`, `rootTable(catalogue)`, `liveContext(context)`, `baraSystemPrompt(context)` y los bloques `IDENTITY_RULES`, `ONTOLOGY_RULES` (autopoiesis: qué hacer con una raíz desconocida), `CONTRACT_RULES` (traducción desde lengua natural). El prompt **se construye con lo que el kernel dice** del documento vivo y del catálogo. |
| `providers.ts` (338) | `WireMessage`, `MAX_WIRE_MESSAGES = 12`, `wireMessages(messages, limit)`, `normalizeBaseUrl`, `HttpRequest`, `anthropicBody`, `anthropicRequest`, `openAiBody`, `openAiRequest`, `chatRequest`, `extractApiError`, `usageOf`, `parseAnthropicResponse`, `parseOpenAiResponse`, `parseChatResponse`, `sendChat`, `listModels` |
| `images.ts` (202) | `ACCEPTED_TYPES = [png, jpeg, webp, gif]` · `MAX_EDGE = 1568` · `MAX_PAYLOAD_BYTES = 4 MB` · `MAX_ATTACHMENTS = 6` · `attachmentId`, `base64Bytes`, `toDataUrl`, `splitDataUrl`, `formatBytes`, `acceptedFiles`, `prepareImage`, `prepareImages`, `filesFromDataTransfer` (+ privadas `readAsDataUrl`, `loadImage`, `drawScaled`: escala/redibuja en `<canvas>` para respetar el tope de 1568 px) |
| `selfcheck.ts` (429) | `CheckResult`, `runSelfCheck()`, `summarize(results)`, `formatReport(results)`; interno `CHECKS: Check[]` con **11 comprobaciones** sin red (helpers `expect`, `memoryStore`, `readyConfig`, `fakeImage`, `userMessage`, `assistantMessage`) |

### 6.6 Capa D — `web/scripts/ai-check.mjs` (40 líneas)

`npm run test:ai`: empaqueta `src/ai/selfcheck.ts` **con la API de Vite** (`build({ configFile:false, ssr:entry, … })`
hacia `node_modules/.cache/bara-ai-selfcheck/selfcheck.mjs`), lo importa y ejecuta `runSelfCheck()`; imprime el informe
y **sale con código 1** si alguna comprobación falla. Cero dependencias nuevas.

---

## 7. Capa F — Configuración, empaquetado y scriptorium

### 7.1 Manifiestos Cargo

| Fichero | Puntos clave |
|---|---|
| `Downloads\Cargo.toml` (raíz) | Workspace **virtual** (`resolver = "2"`) con miembros `BAR`, `bara-ide`, `bara-ide/src-tauri`; `exclude` con 9 carpetas ajenas del usuario (para que `cargo` no crea que pertenecen al workspace); `[profile.release]` = `opt-level = 3`, `lto = true`, `codegen-units = 1`, `panic = "abort"` (única fuente admisible de perfil). |
| `BAR\Cargo.toml` | `bara` v0.1.0, `edition 2021`, MIT, repo `…/Bara-AETHER--Engine-Final-Expansion`; **cero `[dependencies]`**; documenta por qué el perfil vive en `.cargo/config.toml` cuando `BAR` es su propia raíz (CI). |
| `bara-ide\Cargo.toml` | `publish = false`; `[lib] bara_ide` + `[[bin]] bara-ide`; feature `serde` (opt‑in, `serde` ya con `derive`); dependencia `bara = { path = "../BAR" }`; *dev‑dependency* `serde_json` para la prueba de contrato IPC. |
| `bara-ide\src-tauri\Cargo.toml` | `bara-ide-desktop` v0.1.0, `publish = false`; `[lib] bara_ide_desktop_lib` con `crate-type = ["staticlib","cdylib","rlib"]`; `[[bin]] bara-ide-desktop`; `tauri-build` v2 (build), `tauri` v2 **sin plugins**, `serde`/`serde_json`, y `bara-ide = { path = "..", features = ["serde"] }`. |

### 7.2 Front-end

| Fichero | Puntos clave |
|---|---|
| `package.json` | Nombre `bara-ide-desktop`, `type: module`; scripts `dev` (vite), `build` (`tsc --noEmit && vite build`), `preview`, `typecheck` (`tsc --noEmit`), `test:ai` (`node scripts/ai-check.mjs`), `tauri`. Dependencias `@tauri-apps/api ^2`, `react ^19`, `react-dom ^19`; dev: `@tauri-apps/cli ^2`, `@types/node ^24`, `@types/react ^19`, `@types/react-dom ^19`, `@vitejs/plugin-react ^5`, `typescript ^5`, `vite ^7`. |
| `vite.config.ts` | `root: "web"` (en `src/` vive Rust); `clearScreen: false`; servidor `port 1420`, `strictPort`, `host` de `TAURI_DEV_HOST`, HMR en `1421`, `watch.ignored: ["**/src-tauri/**"]`; build `outDir: "dist"`, `target: "chrome105"`, `sourcemap`/`minify` según `TAURI_ENV_DEBUG`. |
| `tauri.conf.json` | `productName: "Bara IDE"`, `mainBinaryName: "bara-ide-desktop"`, v0.1.0, identificador `com.aetheromega.bara.ide`; build `beforeDevCommand: npm run dev`, `beforeBuildCommand: npm run build`, `devUrl: http://localhost:1420`, `frontendDist: ../web/dist`; ventana `main` «Bara IDE — AETHER‑Ω» 1180×760 (mín. 760×520), `resizable`, `center`; `security.csp: null`; bundle activo, `targets: "all"`, 5 iconos, copyright «AETHER‑Ω», categoría `DeveloperTool` + descripciones. |
| `capabilities/default.json` | Ventana `main`, permiso `core:default` (los comandos propios del IDE no necesitan ACL). |
| `.env.example` | `VITE_ANTHROPIC_API_KEY`, `VITE_OPENAI_API_KEY` — solo desarrollo, solo se leen en `npm run dev`; documenta que la clave de verdad se escribe en «Ajustes › IA». |

### 7.3 Guardas y CI del kernel (Capa F)

| Fichero | Qué hace |
|---|---|
| `BAR\scripts\check_profiles.ps1` | `param(...)`, `Read-ReleaseProfile` (extrae `[profile.release]` de un TOML **sin dependencias externas**) y `Compare-ReleaseProfile`; compara la tabla contra `CLAVES` canónicas y **falla si divergen** `Cargo.toml` raíz y `.cargo/config.toml`. |
| `BAR\scripts\ci_status.ps1` | `Get-GitHubToken` (token sin exponerlo en la salida) y `Get-ApiJson` (GET a la API con diagnóstico completo del error); consulta el estado de las comprobaciones del repo. |
| `BAR\.github\workflows\ci.yml` | Nombre «CI — Bara (AETHER‑Ω)»; en `push`/`pull_request` a `dev` y `main`; matriz **ubuntu‑latest / windows‑latest × debug / release** con `cargo test --all-targets --workspace --locked` (y `--release`), caché de registros y `target/`; trabajo de lints: `cargo clippy --all-targets --workspace --locked -- -D warnings`, **grep de totalidad** (sin `expect()`/`unwrap()` en `src/`), `cargo fmt --all --check` y `./scripts/check_profiles.ps1`. |
| `BAR\.github\main-protection.json` | Reglas de la rama principal. |

---

## 8. Cómo ejecutar y verificar (comandos reales del README)

```powershell
# ── Kernel (desde BAR\ o desde la raíz del workspace) ────────────────────────
cargo run -p bara                 # ejecuta el programa génesis (13 fases) y su log ontológico
cargo run -p bara -- --oracle     # fuerza el REPL del oráculo aunque la entrada esté redirigida
cargo run --bin bara_oracle       # binario dedicado del oráculo
cargo test -p bara                # 40 pruebas (30 integración + 10 estrés)

# ── IDE: aval completo del workspace ────────────────────────────────────────
cargo check  --workspace
cargo test   -p bara -p bara-ide --features bara-ide/serde   # kernel + motor (18)
cargo clippy --workspace --all-targets                       # solo verifica: clippy no enlaza
cargo run    -p bara-ide -- samples\genesis.bara             # CLI: --tokens | --summary | --help | --version

# ── Interfaz ────────────────────────────────────────────────────────────────
npm run typecheck       # tsc --noEmit
npm run test:ai         # 11 comprobaciones del panel de IA, sin red
npm run build           # tsc --noEmit && vite build -> web/dist
npm run tauri dev       # ventana de escritorio (Vite en 1420 + backend Rust)
npm run tauri build     # instalador (requiere enlazador MSVC o MinGW completo)

# ── Guardas del kernel ──────────────────────────────────────────────────────
pwsh ./BAR/scripts/check_profiles.ps1   # coherencia del perfil release entre ambos manifiestos
```

Notas de entorno (documentadas en el README del IDE): la feature `serde` se pide **a mano** al probar el motor para
que se compile tal y como lo consume el backend; `cargo test --workspace` intentaría además los *harneses* del
backend Tauri y con el toolchain `x86_64-pc-windows-gnu` el enlazador aborta (`export ordinal too large`) — por eso el
backend se cubre con `cargo check` + `cargo clippy`.

---

## 9. Estado del árbol de trabajo (guardado en GitHub)

Todo este trabajo está **commiteado y empujado** a `origin/main`
(`https://github.com/usercardjoke1036991-star/Bara-AETHER--Engine-Final-Expansion-IDE.git`):

| Commit | Contenido |
|---|---|
| `bef5b3b` | `fix(tauri): arranque del .exe con toolchain GNU sin windres` — 4 ficheros, +551/−8: `build.rs`, `.cargo/config.toml`, `scripts/win-gnu-runner.py`, `scripts/win-gnu-recursos.py` |
| `be097b0` | `docs: inventario funcional del workspace (kernel + IDE)` — 2 ficheros, +606: `docs/INVENTARIO.md` y su enlace en `README.md` |

El árbol queda **limpio** (`git status --short` sin salida) y `main` al día con `origin/main`. El kernel **`BAR` no
necesitó cambios**: sigue limpio y sincronizado en su rama `dev` (`## dev...origin/dev`).

Antes del commit el reconocimiento dejó este estado (`git status --porcelain`, 12/10/2026):

```
bara-ide>  M src-tauri/build.rs
bara-ide> ?? docs/
bara-ide> ?? src-tauri/.cargo/
bara-ide> ?? src-tauri/scripts/
BAR>       (sin cambios)
```

**Salida literal del `git push`:**

```
To https://github.com/usercardjoke1036991-star/Bara-AETHER--Engine-Final-Expansion-IDE.git
   76f6b2d..be097b0  main -> main
```

Commits anteriores del IDE (contexto): `76f6b2d chore(git): ignorar la cache del autodiagnostico bajo web/node_modules` ·
`bea4a84 chore: árbol completo de la interfaz Bara (Tauri + React)` ·
`5efc893 feat(ipc): expone oráculo, biláttice de Belnap y control temporal Δ⁻¹ del kernel`.
Últimos commits del kernel: `66aff83 fix(calidad): cierra H1-H6 (totalidad, perfiles, formato y metricas)` ·
`04967ee chore(scripts): versionar el helper de CI como scripts/ci_status.ps1` ·
`c7fa4a0 ci(workflow): YAML apto para validadores estrictos (yamllint limpio)`.


---

## 10. Traza de una acción (para entender el conjunto)

Escribir una raíz en el editor dispara exactamente esta cadena, sin ramas ni duplicaciones:

1. **`App.tsx`** guarda el texto y, tras el rebote (~200 ms), llama a `analyzeSource(text)`.
2. **`engine.ts`** → `invoke("analyze_source", { source })` (IPC).
3. **`src-tauri/src/lib.rs`** → `analyze_source` (comando `#[tauri::command]`).
4. **`bara-ide` (lib)** → `analyze(source)`, que llama al **lexer** del kernel y proyecta tokens, resumen e inventario.
5. **`bara` (kernel)** → `lexer::Lexer::new(source).tokenize()` (total, sin `unwrap`). Si el texto es de oráculo, el
   mismo camino pasa por `repl::Oracle::converse` y `temporal_rollback::TemporalEngine` (`Δ⁻¹`).
6. Vuelta atrás: `Analysis` → JSON (feature `serde` de `bara-ide`) → React pinta raíces, tabla de *tokens* y, si
   procede, el turno, el informe de sesión y la biláttice.
7. El panel de IA añade contexto **vivo** (`prompt.ts`: `liveContext` + `baraSystemPrompt`) construido con ese mismo
   `Analysis` y con el catálogo del kernel; los bloques de código que devuelve el modelo se pueden reinyectar en el
   editor, que vuelve al paso 1.

## 11. Resumen numérico

| Magnitud | Valor |
|---|---|
| Crates / paquetes | 3 (`bara`, `bara-ide`, `bara-ide-desktop`) |
| Módulos del kernel | 11 (+ `lib`/`main`) |
| Binarios | **5 ejecutables**: `bara`, `bara_oracle`, `bara-ide` (CLI), `bara-ide-desktop` |
| Fases del génesis | 13 |
| Meta‑comandos del oráculo | 11 variantes (`10` + `Unknown`) con alias en español e inglés |
| Clases de `TokenKind` | 16 |
| Raíces semánticas | 6 |
| Valencias de Belnap | 4 |
| Comandos IPC | 14 |
| Funciones del cliente IPC (`engine.ts`) | 15 |
| Componentes React | 3 + `App`/`SummaryPanel` |
| Módulos de IA | 6 (1 417 líneas) |
| Pruebas | kernel **40** (30 + 10) · motor del IDE **18** · autodiagnóstico IA **11** |
| Dependencias externas del kernel | **0** (`std` puro) |
| `unsafe` en el kernel | **0** |
| Líneas de Rust del IDE | ≈ 1 888 (motor 1 509 + backend 189 + `build.rs` 190) |
| Líneas del kernel | ≈ 7 900 de código + ≈ 2 000 de pruebas |
| Idiomas del oráculo | entrada/salida en español, inglés y hebreo (alias plegados sin acentos) |

---

*Documento generado por reconocimiento de solo lectura sobre el árbol real; todos los nombres, rutas y recuentos
proceden de los ficheros citados. Las únicas discrepancias detectadas con la documentación previa son: el README del
IDE anuncia **11** pruebas del motor cuando `src/lib.rs` contiene **18**, y la sección de verificación de este
documento añade el recuento real de cada suite.*

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

**Actualización (14/10/2026):** se incorporan la **capa AETHER‑Ω** (cinco módulos exteriores de sólo lectura),
`fractal_geometry` y el **constructor visual** (`visual_builder.rs` + su panel), y se corrigen los recuentos con
mediciones de hoy: **17 módulos** en el kernel, **25 comandos IPC**, **110** pruebas del kernel y **34** del motor del
IDE. La sección 3.1 detalla la API de los diez módulos del núcleo y la 3.3 la de los siete módulos añadidos después;
el contrato del lienzo se documenta además en `docs/VISUAL_BUILDER.md` y la capa exterior en `BAR/README.md`.

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
web/ (React 19 + TS + Vite 7)  ──IPC──▶  src-tauri/ (Tauri v2 · 25 comandos)
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
| **A** | `bara-ide/src` | Motor del IDE: modelo serializable, proyecciones AETHER‑Ω (`aether.rs`), constructor visual (`visual.rs`) y CLI histórica (`bara-ide`) |
| **B** | `bara-ide/src-tauri` | Backend Tauri v2 (`bara-ide-desktop`): 25 comandos IPC + build.rs + scripts de toolchain GNU |
| **C** | `bara-ide/web/src` | Interfaz React/TypeScript (ventana, editor, tabla de tokens, paneles AETHER‑Ω, lienzo visual y panel de IA) |
| **D** | `bara-ide/web/scripts` | Autodiagnóstico en Node (`ai-check.mjs`) |
| **E** | `BAR/src` | Kernel `bara`: 17 módulos + 2 binarios |
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
│   │   ├── lib.rs            (65)   17 `pub mod` + 5 reexportaciones
│   │   ├── main.rs           (782)  bin `bara` (programa génesis, 13 fases)
│   │   ├── bin\bara_oracle.rs (335) bin `bara_oracle` (REPL interactivo)
│   │   ├── lexer.rs          (388)
│   │   ├── runtime.rs        (1203)
│   │   ├── memory_region.rs  (317)
│   │   ├── zk_proof.rs       (482)
│   │   ├── ffi_ingest.rs     (1108)
│   │   ├── fractal_geometry.rs (463)
│   │   ├── temporal_rollback.rs (273)
│   │   ├── quantum_native.rs (955)
│   │   ├── mesh_sync.rs      (1053)
│   │   ├── metal_ir.rs       (949)
│   │   ├── repl.rs           (865)
│   │   ├── visual_builder.rs (1614) constructor visual → *Shoresh* firmado
│   │   ├── ast_dna.rs        (483)  AETHER‑Ω
│   │   ├── crypto_native.rs  (1722) AETHER‑Ω
│   │   ├── emission.rs       (1577) AETHER‑Ω
│   │   ├── immunity_gateway.rs (1241) AETHER‑Ω
│   │   └── net_camouflage.rs (2919) AETHER‑Ω
│   └── tests\
│       ├── integration_suite.rs (1685)
│       ├── fractal_suite.rs     (330)
│       └── stress_test.rs       (596)
│
└── bara-ide\                          IDE
    ├── Cargo.toml  package.json  package-lock.json
    ├── vite.config.ts  tsconfig.json  README.md  .env.example  .gitignore
    ├── docs\
    │   ├── INVENTARIO.md              (este documento)
    │   └── VISUAL_BUILDER.md          contrato del constructor visual (lienzo → *Shoresh* firmado)
    ├── samples\genesis.bara
    ├── src\
    │   ├── lib.rs   (1439)   motor: tipos + informes + 34 pruebas
    │   ├── aether.rs (1580)  paneles AETHER‑Ω (autopoiesis, ψ, malla, Metal-IR, Δ⁻¹, fractales)
    │   ├── visual.rs (711)   constructor visual: lienzo → `bara::visual_builder` + sello del IDE
    │   └── main.rs  (101)    CLI `bara-ide`
    ├── src-tauri\
    │   ├── Cargo.toml  tauri.conf.json  build.rs (190)
    │   ├── capabilities\default.json
    │   ├── icons\  (32/128/256/512.png, icon.ico, icon.icns)
    │   ├── .cargo\config.toml         [sin commitear] runner GNU
    │   ├── scripts\                   [sin commitear]
    │   │   ├── win-gnu-runner.py   (48)
    │   │   └── win-gnu-recursos.py (388)
    │   └── src\{lib.rs (310), main.rs (12)}
    └── web\
        ├── index.html
        ├── scripts\ai-check.mjs  (40)
        └── src\
            ├── main.tsx (17)  App.tsx (548)  engine.ts (280)  aether.ts (551)
            ├── visual.ts (198)  styles.css  vite-env.d.ts
            ├── ai\{types.ts (79), config.ts (241), images.ts (202),
            │       prompt.ts (129), providers.ts (338), selfcheck.ts (429)}
            └── components\{ChatPanel.tsx (543), AiSettings.tsx (229),
                            AssistantText.tsx (146), KernelPanel.tsx (199),
                            KernelCards.tsx (745), VisualBuilder.tsx (491)}
```

**Métricas (14/10/2026):** 4 343 líneas de Rust en el IDE —motor 3 831 (`lib.rs` 1 439 + `aether.rs` 1 580 +
`visual.rs` 711 + CLI 101) + backend 322 (`src-tauri/src`) + `build.rs` 190—; kernel: **18 794** líneas de código
(`src/` + `src/bin/`) y **2 611** de pruebas (`tests/`). Recuento con `Get-Content` / `find /c /v ""` sobre los ficheros.

---

## 3. Capa E/F — Kernel `bara` (`BAR`)

### 3.1 Los diez módulos del núcleo y su API pública

#### `lexer.rs` — análisis léxico triconsonántico (388 líneas)
| Elemento | Detalle |
|---|---|
| `enum Keyword` | `Manifest` (`ברא` manifestar/creación ex nihilo) · `Guard` (`שמר` guardar/aislamiento de día‑cero) · `Synthesize` (`חכם` sintetizar/heurística adaptativa) · `Execute` (`עבד` ejecutar/colapso) · `Emit` (`אמר` emitir/enunciar) · `Judge` (`שפט` juzgar/evaluación lógica) |
| métodos | `from_root(root) -> Option<Keyword>` · `glyph() -> &'static str` · `meaning() -> &'static str` |
| `enum TokenKind` | 16 clases: `Root{letters, keyword}` · `Identifier(String)` · `Number(f64)` · `Str(String)` · `Colon` `:` · `Semicolon` `;` · `Comma` `,` · `Arrow` `->` · `Plus` `+` (disyunción paraconsistente) · `Star` `*` (conjunción) · `Bang` `!` (colapso/observación) · `BangBang` `!!` (fusión paraconsistente) · `Question` `?` (observación heurística) · `Punct(char)` (cualquier otro símbolo, **preservado sin juicio**) · `Newline` · `Eof` |
| `struct Token` | glifo, semántica, ubicación física (línea/columna) · `keyword()` |
| `struct Lexer` | `new(source)`, `tokenize()` |

#### `runtime.rs` — estado cuántico, memoria holográfica y ejecución (1203 líneas)
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

#### `memory_region.rs` — inferencia de regiones zero‑copy CPU/GPU (317 líneas)
`RegionId(pub usize)` · `RegionKind` + `label`,`glyph` · `Device` + `label` · `Region` · `ZeroCopyHandle` · `Access` ·
`RegionPlan` · `RegionTable` + `new`, `introduce`, `get`, `regions`, `len`, `is_empty`, `total_bytes`, `max_depth`,
`depth_of`, `contains`, `share` · `RegionAnalyzer::infer(accesses) -> RegionPlan`

#### `zk_proof.rs` — verificación ZK‑SNARK del AST (482 líneas)
`const P` (primo de referencia) · `Fp(pub u64)` + `new`, `pow`, `inv`, `is_zero` · `Poly` + `zero`, `constant`,
`is_zero`, `degree`, `eval`, `add`, `sub`, `mul`, `vanishing`, `commit` · `Statement` · `ConstraintSystem` +
`from_invariants`, `statement` · `ZkEvals` · `Proof` · `VerifyResult` · `fn prove(system, statement)` ·
`fn verify(statement, proof)` · `ZkCertificate::certify(system, statement)`

#### `ffi_ingest.rs` — ingesta omnívora de legado C/Python/JSON/TypeScript (1108 líneas)
`LegacyLang` + `label` · `Param` · `IngestedDecl` · `BaraType` + `label`, `glyph`, `from_legacy(ctype)` ·
`ShoreshNode` · `ShoreshAst` + `hazard_score`, `sanitized_count`, `roots()` · `BelnapCensus` ·
`const MAX_STRUCT_MEMBERS = 4` · `fn root_from_name(name)` ·
`fn hazard_of(text)` · `fn sanitize(decl) -> (f64, QuantumState, bool)` · `fn to_shoresh(decls)` ·
`fn ingest_c(source) -> Vec<IngestedDecl>` · `fn ingest_python(source) -> Vec<IngestedDecl>` ·
`fn ingest_json(source) -> Vec<IngestedDecl>` · `fn ingest_typescript(source) -> Vec<IngestedDecl>` ·
`fn detect_lang(source) -> Option<LegacyLang>` · `fn ingest(source, lang) -> Vec<IngestedDecl>` ·
`fn ingest_auto(source) -> Vec<IngestedDecl>` · `fn ingest_auto_to_shoresh(source) -> ShoreshAst`

#### `temporal_rollback.rs` — navegación temporal y `Δ⁻¹` (273 líneas)
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

#### `repl.rs` — oráculo interactivo con monitor `Δ⁻¹` (865 líneas)
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
| `bara_oracle` | `src/bin/bara_oracle.rs` (335) | REPL del oráculo: 11 meta‑comandos (`10` + `Unknown`), turnos, `Δ⁻¹`, informe. |

### 3.3 Módulos añadidos después del primer reconocimiento

`fractal_geometry` pertenece al **núcleo** (reparto espacial de la memoria holográfica); `ast_dna`, `crypto_native`,
`emission`, `immunity_gateway` y `net_camouflage` forman la **capa AETHER‑Ω** (exterior y de **sólo lectura** sobre
el AST *Shoresh*), y `visual_builder` es el motor del **constructor visual** del IDE. Ninguno añade dependencias ni
`unsafe`, y todos nacen con **0 llamadas a `unwrap()`/`expect()`** (axioma A1).

#### `fractal_geometry.rs` — proporción áurea y reparto fractal (463 líneas)
`phi()` · `golden_angle()` · `padding_bound()` · `POW2_PADDING_BOUND` · `FIB_SATURATION_INDEX` · `fibonacci(n)` ·
`fib_series(n)` · `harmonic_series(n)` · `fib_ceil(bytes)` · `pow2_ceil(bytes)` · `golden_key(index)` ·
`golden_order(count)` · `golden_slots(count)` · `FractalLayout` (`lib.rs` reexporta `fibonacci`, `fib_ceil`,
`golden_angle`, `golden_slots` y `FractalLayout`).

#### `ast_dna.rs` — ADN sintáctico firmado (483 líneas)
`GOLDEN_FRACTION` · `DNA_KEY_INFO` · `type_code(kind)` · `root_fold(root)` · `canonical_node_bytes(node)` ·
`node_identity(node)` · `golden_key(seed)` · `NodeDna` + `node_dna(node)` · `merkle_root(leaves)` · `key_id(key)` ·
`AstDna` · `ast_dna(label, ast, key)` · `signature_is_valid(dna, key)` · `verify(label, ast, dna, key)` ·
`short_hex(bytes)`

#### `crypto_native.rs` — bóveda criptográfica autóctona (1722 líneas)
`Sha256` · `sha256(data)` · `sha256_hex(data)` · `digest_eq(left, right)` · `SHA256_BLOCK` ·
`hmac_sha256(key, message)` · `hkdf_extract(salt, ikm)` · `hkdf_expand(prk, info, out)` ·
`hkdf_sha256(salt, ikm, info, out)` · `hkdf_32(salt, ikm, info)` · `chacha20_block(key, counter, nonce)` ·
`chacha20_xor(key, counter, nonce, data)` · `poly1305_mac(message, key)` · `AEAD_TAG` ·
`aead_seal(key, nonce, aad, plaintext)` · `aead_open(key, nonce, aad, sealed)` · `AES128_KEY` · `AES_BLOCK` ·
`AES128_SCHEDULE` · `GCM_TAG` · `AES128_ROUNDS` · `Aes128` · `aes128_gcm_seal` · `aes128_gcm_open(key, nonce, aad, sealed)` ·
`x25519(scalar, u_coordinate)` · `x25519_base(scalar)`

#### `emission.rs` — emisión multiplataforma (1577 líneas)
`EmitFormat` · `EmitHost` · `EmitOptions` · `SectionRecord` · `EmissionArtifact` ·
`seal_statement(label, digest, root)` · `write_var_u32` · `write_var_i32` · `read_var_u32` · `read_var_i32` ·
`WASM_HEADER` · `WASM_PAGE` · `SAFE_WASM_OPS` · `is_safe_wasm_op(opcode)` · `wasm_section_name(id)` ·
`collect_wasm_sections(module)` · `WasmSummary` · `parse_wasm(module)` · `wasm_note(id)` · `emit_wasm` ·
`AETHER_MAGIC` · `AetherRecord` · `aether_record(dna, metal)` · `parse_aether(bytes)` · `ELF_BASE` ·
`ELF_TEXT_OFFSET` · `PORTABLE_MAGIC` · `NativeSummary` · `parse_native(image)` · `native_note(name)` · `emit_native`

#### `immunity_gateway.rs` — pasarela de inmunidad paraconsistente (1241 líneas)
`MAX_PAYLOAD` · `Packet` · `LoopbackIngress` · `TcpIngress` · `DESIGNATION` · `DANGER_CEILING` ·
`SIZE_BOMB_BYTES` · `CONTROL_PADDING_PERMILLE` · `ATTACK_NEEDLES` · `MARK_SIZE_BOMB` · `MARK_CONTROL_PADDING` ·
`MARK_DEEP_NESTING` · `MARK_NUL` · `MARK_UNREADABLE` · `Threat` · `is_legible(payload)` · `threat_of(payload)` ·
`BubbleVerdict` · `Bubble` · `neutralized(payload, seed)` · `DoorPolicy` · `Gateway` · `GatewayReport` · `shelter`

#### `net_camouflage.rs` — camuflaje de red TLS 1.3 (2919 líneas)
Registro: `CT_CHANGE_CIPHER_SPEC` · `CT_ALERT` · `CT_HANDSHAKE` · `CT_APPLICATION_DATA` · `HS_CLIENT_HELLO` ·
`HS_SERVER_HELLO` · `HS_ENCRYPTED_EXTENSIONS` · `HS_CERTIFICATE` · `HS_CERTIFICATE_VERIFY` · `HS_FINISHED` ·
`LEGACY_VERSION` · `LEGACY_RECORD_VERSION` · `TLS13_VERSION` · `TLS_AES_128_GCM_SHA256` ·
`TLS_AES_256_GCM_SHA384` · `TLS_CHACHA20_POLY1305_SHA256` · `TLS_AES_128_CCM_SHA256` · `SUITE_AES128_KEY` ·
`SUITE_CHACHA_KEY` · `SUITE_IV` · `FINISHED_LEN` · `suite_key_length(cipher)` · `suite_is_supported(cipher)` ·
`suite_name(cipher)` · `GROUP_X25519` · `GROUP_SECP256R1` · `SIG_ECDSA_P256` · `SIG_RSA_PSS` · `SIG_ED25519` ·
extensiones `EXT_SERVER_NAME` … `EXT_KEY_SHARE` · `PSK_DHE_KE` · `MAX_RECORD` · `CAMOUFLAGE_MARK` ·
`BROWSER_SESSION_ID` · `initial_record(content_type, payload)` · `plain_record(content_type, payload)` ·
`CamouflageProfile` · `DnaStream` · `client_hello_body` · `client_hello` · `swarm_adn(seed)` ·
`camouflage_mark(adn, fingerprint, random)` · `fingerprint_of(body)` · `CamouflagedClient` · `ParsedClientHello` ·
`parse_client_hello(message)` · `verify_camouflage(message, adn)` · `ParsedServerHello` · `server_hello` ·
`parse_server_hello(message)` · `hkdf_expand_label(secret, label, context, length)` ·
`derive_secret(secret, label, transcript_hash)` · `transcript_hash(messages)` · `HandshakeSecrets` ·
`handshake_secrets(shared, transcript)` · `master_secret(handshake_secret)` · `application_secrets` ·
`TrafficKeys` · `record_overhead()` · `seal_record` · `open_record(keys, sequence, message)` ·
`parse_finished(record)` · `parse_encrypted_extensions(record)` · `finished_key(traffic_secret)` ·
`finished_verify_data(finished_key, transcript)` · `verify_finished` · `finished_message(verify_data)` ·
`seal_finished` · `HandshakeState` · `ServerHelloOutcome` · `FinishedOutcome` · `ApplicationKeys` ·
`HandshakeMachine` · `READ_TIMEOUT_MS` · `HttpsSession`

#### `visual_builder.rs` — constructor visual: lienzo → *Shoresh* firmado (1614 líneas)
`MAX_BLOCKS` (256) · `MAX_BLUEPRINT_BYTES` (64 KiB) · `MAX_JSON_DEPTH` (32) · `MAX_ID_CHARS` (64) ·
`SEAL_THRESHOLD` (0.5) · `MIN_CELL_DISTANCE` (0.28) · `BlockKind` · `Slot` · `VisualBlock` · `Blueprint` · `Cell` ·
`VisualCheck` · `VisualReport` · `VisualBuild` · `bara_type_from_name(name)` · `valid_id(id)` ·
`triconsonantal(root)` · `parse_blueprint(json)` · `layout(count)` · `min_distance(cells)` · `radius(cells)` ·
`topological(blueprint)` · `depth(blueprint)` · `risk_bounds(blueprint)` · `validate(blueprint)` ·
`edges(blueprint)` · `blueprint_ast(blueprint)` · `blueprint_source(blueprint)` ·
`build_blueprint(blueprint, key)` · `build(json, key)` · `build_composed(lienzos, key)` · `SAMPLE_BLUEPRINT` ·
`sample_blueprint()`

El contrato del lienzo (esquema JSON, clases de bloque, tipos, informe `VisualReport` y cotas) está documentado en
`bara-ide/docs/VISUAL_BUILDER.md`; el panel que lo consume, en el README del IDE.

### 3.4 Las 13 fases del génesis (orden exacto)

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

### 3.5 Pruebas y guardas de calidad (Capa F)

* `cargo test -p bara`: **110** pruebas = **59** unitarias (una por módulo: `ast_dna` 5, `crypto_native` 12,
  `emission` 6, `fractal_geometry` 9, `immunity_gateway` 8, `net_camouflage` 11, `visual_builder` 8) más **51** de
  integración (`tests/integration_suite.rs` 1685 líneas / **33** pruebas · `tests/fractal_suite.rs` 330 / **8** ·
  `tests/stress_test.rs` 596 / **10**).
* `cargo test -p bara -p bara-ide --features bara-ide/serde`: **144** en el workspace (los 110 del kernel más **34**
  del motor del IDE: `lib.rs` 18, `aether.rs` 11, `visual.rs` 5).
* Guardas declaradas: **grep de totalidad** (sin `expect`/`unwrap` en `src`), `scripts/check_profiles.ps1` (perfiles), `cargo fmt`, `cargo clippy`, `.github/workflows/ci.yml` (5 verificaciones) y `.github/main-protection.json`.
* `manifests/shoresh_manifest.bara` — manifiesto de ejemplo en raíces *Shoresh* que consume `Oracle::run_manifest`.

---

## 4. Capa A — Motor del IDE (`bara-ide`: `src/lib.rs` + `src/aether.rs` + `src/visual.rs` + `src/main.rs`)

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

### 4.5 Pruebas del motor (34 `#[test]`: 18 en `lib.rs`, 11 en `aether.rs`, 5 en `visual.rs`)

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

### 4.6 Capa AETHER‑Ω y constructor visual (`src/aether.rs` + `src/visual.rs`)

* `aether.rs` (1580 líneas) proyecta siete servicios del kernel para los paneles: `AutopoiesisReport` (+
  `ZkGateView`), `QuantumView`, `MeshView`, `MetalView`, `TimelineView` y `FractalMemoryView`, con las funciones
  `autopoiesis(source)`, `quantum_register(source)`, `mesh_status(source, peers, rounds, threaded)`,
  `metal_program(source, device)`, `timeline(source)`, `fractal_memory(source)` y `fractal_plan(widths)`.
* `visual.rs` (711 líneas) envuelve `bara::visual_builder`: `visual_catalogue() -> VisualCatalogueView` (clases de
  bloque, tipos y cotas **servidos por el kernel**, de modo que el panel no repite un solo literal del contrato),
  `visual_sample() -> String`, `visual_build(blueprint: &str) -> Result<VisualBuildView, String>` y
  `visual_compose(blueprints: &[String]) -> Result<VisualBuildView, String>`. Cada ADN se firma con la semilla
  **pública y fija** del IDE (`VISUAL_KEY_SEED`): prueba **integridad y reproducibilidad**, no identidad de usuario.

---

## 5. Capa B — Backend Tauri (`bara-ide/src-tauri`, crate `bara-ide-desktop`)

### 5.1 Los 25 comandos IPC (`src/lib.rs`, 310 líneas)

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
| 12 | `temporal_rollback` | `(marker: u64, state) -> Result<TurnResult, String>` |
| 13 | `belnap_lattice` | `() -> BelnapLattice` |
| 14 | `belnap_evaluate` | `(truth: f64, falsity: f64) -> BelnapEvaluation` |
| 15 | `autopoiesis` | `(source: String) -> AutopoiesisReport` |
| 16 | `quantum_native` | `(source: String) -> QuantumView` |
| 17 | `mesh_sync` | `(source: String, peers: usize, rounds: usize, threaded: bool) -> MeshView` |
| 18 | `metal_ir` | `(source: String, device: Option<String>) -> MetalView` |
| 19 | `temporal_timeline` | `(source: String) -> TimelineView` |
| 20 | `fractal_memory` | `(source: String) -> FractalMemoryView` |
| 21 | `fractal_plan` | `(widths: Vec<usize>) -> FractalMemoryView` |
| 22 | `visual_catalogue` | `() -> VisualCatalogueView` |
| 23 | `visual_sample` | `() -> String` |
| 24 | `visual_build` | `(blueprint: String) -> Result<VisualBuildView, String>` |
| 25 | `visual_compose` | `(blueprints: Vec<String>) -> Result<VisualBuildView, String>` |

Además: `fn with_session<T>(...)` (ayudante que resuelve el `Mutex<Session>` y traduce los fallos a errores legibles)
y `pub fn run()` (arranque de la aplicación Tauri, con `tauri::generate_handler!` listando los **25** comandos; se
invoca desde `src/main.rs`, 12 líneas).

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
| `scripts/win-gnu-recursos.py` (388) | Embebe los recursos que `windres` habría puesto, **solo con `ctypes`** y de forma **idempotente**: `RT_MANIFEST` (id 1) con la dependencia **Common‑Controls 6.0.0.0**; `RT_ICON` + `RT_GROUP_ICON` desde `icons/icon.ico`, con el grupo en dos ids — `1` (icono “principal” del `.exe`, el del Explorador) y `32512 = ID_ICONO_APP` (`tauri_utils` lo busca para el icono de ventana); **copia `WebView2Loader.dll`** junto al `.exe` (en MSVC va estático). Funciones clave: `leer_ico()` (ICO multi‑tamaño), `embebe_recursos()` (`BeginUpdateResourceW` / `UpdateResourceW` / `EndUpdateResourceW`), `_existe_recurso()` (`LoadLibraryExW` con `LOAD_LIBRARY_AS_DATAFILE` + `FindResourceW`, sin ejecutar nada). Uso: `--exe RUTA [--forzar]`, `--wait 900` (espera al enlace) y `--probar 20` (prueba de humo: lanza y mide segundos de supervivencia). |

---

## 6. Capa C/D — Interfaz React (`bara-ide/web`)

React 19 + TypeScript 5 + Vite 7. Cinco ficheros raíz (`main.tsx`, `App.tsx`, `engine.ts`, `aether.ts`, `visual.ts`),
seis módulos en `ai/` y seis componentes. **Regla de oro:** la interfaz no traduce ni reinterpreta el kernel; solo
pinta lo que recibe.

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
* Los otros dos clientes IPC tipados son `aether.ts` (551 líneas), que cubre los siete comandos de la capa AETHER‑Ω
  (`autopoiesis`, `quantum_native`, `mesh_sync`, `metal_ir`, `temporal_timeline`, `fractal_memory`, `fractal_plan`)
  con sus tipos espejo (`AutopoiesisReport`, `QuantumView`, `MeshView`, `MetalView`, `TimelineView`,
  `FractalMemoryView`), y `visual.ts` (198), con los cuatro del constructor visual (`visual_catalogue`,
  `visual_sample`, `visual_build`, `visual_compose` → `VisualCatalogueView`, `VisualBuildView`).

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
* Los otros dos paneles de la barra superior se abren igual desde `App`, también fuera de la rejilla:
  **«paneles AETHER‑Ω»** (`KernelPanel` + `KernelCards`, servidos por los siete comandos de `aether.ts`) y
  **«lienzo visual»** (`VisualBuilder`, servido por los cuatro comandos de `visual.ts`).

### 6.4 Componentes (`web/src/components`)

| Fichero | Qué expone |
|---|---|
| `ChatPanel.tsx` (543) | `ChatPanelProps` + `ChatPanel` (por defecto) + internos `MessageRow`, `TranslationBox`, `newId`, `reasonOf`. Pintado: `aside.ai-panel` (con estado `dragging`), `header.ai-head`, `div.ai-body`, `div.ai-log`, bienvenida `ai-welcome` + `describeConfig`, lista `ai-problems`, indicador `consultando al modelo…`, `form.ai-composer` (`textarea.code.ai-input`), chips de imágenes `ai-chips`/`ai-chip`(+`formatBytes`), zona de adjuntar `label.ai-attach`, `details.ai-report` con el **prompt del sistema** (con su recuento de caracteres) y otro con el **autodiagnóstico**; cada mensaje es `article.ai-msg.{user|assistant}` con `ai-msg-head` (nombre del modelo), miniaturas `ai-thumbs`, error `ai-error`; los bloques cercados se muestran en `div.ai-code` con `TranslationBox` («usar en el editor» → `shoresh_translate`). |
| `AiSettings.tsx` (229) | `AiSettings` (por defecto); `PROVIDERS: ProviderId[] = ["anthropic","openai"]`, `clamp`. Pintado: `div.ai-settings` con campos `label.ai-field` (proveedor, modelo, clave con `maskSecret` y `sin clave`, raíz de la API, `maxTokens` con `clamp`, temperatura), casillas `label.ai-check` (incluida la de enviar `max_completion_tokens` para modelos de razonamiento), lista `ai-problems`, `describeConfig`, `modelos: {status}` (resultado de `listModels`) y botones de acción. |
| `AssistantText.tsx` (146) | `Block`, `splitBlocks(markdown)` (separador de bloques cercados con `FENCE = /^\s*```([A-Za-z0-9_+-]*)\s*$/`), `codeBlocks(markdown)`, `AssistantText` (por defecto) + internos `renderInline`, `CodeBlock`. Pinta `div.ai-answer` con prosa `p.ai-text` y bloques `div.ai-code` (`ai-code-head` con el lenguaje y botón de copiar/usar, `pre.ai-code-body`); código en línea `inline-code`; `Sin respuesta.` si no hay nada. |
| `KernelPanel.tsx` (199) | `KernelPanel` (por defecto): selector de los siete paneles AETHER‑Ω del kernel (autopoiesis, cuántica, malla, Metal‑IR, `Δ⁻¹` y fractales) y estado de carga; delega el pintado en `KernelCards`. |
| `KernelCards.tsx` (745) | Un componente por proyección del kernel: informe de autopoiesis con la puerta ZK, banco de qubits y par de Bell, malla holográfica con relojes vectoriales, programa Metal‑IR, diario temporal y reparto áureo/Fibonacci de la memoria. |
| `VisualBuilder.tsx` (491) | `VisualBuilder`: editor del lienzo JSON estricto (contrato pedido al kernel), retícula áurea, grafo de bloques, los siete chequeos del informe (`VisualCheck`) y salida doble (guion *Shoresh* y ADN firmado); compone hasta `MAX_COMPOSED_CANVASES` (**8**) lienzos. |

### 6.5 Panel de IA (`web/src/ai`, 1 418 líneas)

| Fichero | API pública |
|---|---|
| `types.ts` (79) | `ProviderId = "anthropic" \| "openai"` · `ChatRole = "user" \| "assistant"` · `ImageAttachment` · `ChatMessage` · `AiConfig` · `ChatUsage` · `ChatResult` · `ModelInfo` |
| `config.ts` (241) | `STORAGE_KEY = "bara-ide.ai.config.v1"` · `PROVIDER_ENDPOINTS` · `PROVIDER_LABELS` · `PROVIDER_ENV_KEYS` · `PROVIDER_MODEL_PRESETS` · `ANTHROPIC_VERSION = "2023-06-01"` · `ANTHROPIC_BROWSER_HEADER = "anthropic-dangerous-direct-browser-access"` · `DEFAULT_CONFIG` · `TOKEN_RANGE = {min:256,max:8192}` · `KeyValueStore` · funciones `defaultStore`, `envValue`, `envKeyFor`, `sanitizeConfig`, `loadStoredConfig`, `loadConfig`, `saveConfig`, `forgetConfig`, `withProvider`, `maskSecret`, `configProblems`, `describeConfig` |
| `prompt.ts` (129) | `MAX_DOCUMENT_CHARS = 4000` · `PromptContext` · `excerpt(source, max)`, `inventoryLine(analysis)`, `rootTable(catalogue)`, `liveContext(context)`, `baraSystemPrompt(context)` y los bloques `IDENTITY_RULES`, `ONTOLOGY_RULES` (autopoiesis: qué hacer con una raíz desconocida), `CONTRACT_RULES` (traducción desde lengua natural). El prompt **se construye con lo que el kernel dice** del documento vivo y del catálogo. |
| `providers.ts` (338) | `WireMessage`, `MAX_WIRE_MESSAGES = 12`, `wireMessages(messages, limit)`, `normalizeBaseUrl`, `HttpRequest`, `anthropicBody`, `anthropicRequest`, `openAiBody`, `openAiRequest`, `chatRequest`, `extractApiError`, `usageOf`, `parseAnthropicResponse`, `parseOpenAiResponse`, `parseChatResponse`, `sendChat`, `listModels` |
| `images.ts` (202) | `ACCEPTED_TYPES = [png, jpeg, webp, gif]` · `MAX_EDGE = 1568` · `MAX_PAYLOAD_BYTES = 4 MB` · `MAX_ATTACHMENTS = 6` · `attachmentId`, `base64Bytes`, `toDataUrl`, `splitDataUrl`, `formatBytes`, `acceptedFiles`, `prepareImage`, `prepareImages`, `filesFromDataTransfer` (+ privadas `readAsDataUrl`, `loadImage`, `drawScaled`: escala/redibuja en `<canvas>` para respetar el tope de 1568 px) |
| `selfcheck.ts` (429) | `CheckResult`, `runSelfCheck()`, `summarize(results)`, `formatReport(results)`; interno `CHECKS: Check[]` con **12 comprobaciones** sin red (helpers `expect`, `memoryStore`, `readyConfig`, `fakeImage`, `userMessage`, `assistantMessage`) |

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
| `tauri.conf.json` | `productName: "Bara IDE"`, `mainBinaryName: "bara-ide-desktop"`, v0.1.0, identificador `com.aetheromega.bara.ide`; build `beforeDevCommand: npm run dev`, `beforeBuildCommand: npm run build`, `devUrl: http://localhost:1420`, `frontendDist: ../web/dist`; ventana `main` «Bara IDE — AETHER‑Ω» 1180×760 (mín. 760×520), `resizable`, `center`; `security.csp` con allowlist (Anthropic, OpenAI, DeepSeek; sin esquema `https:` suelto); bundle activo, `targets: "all"`, 5 iconos, copyright «AETHER‑Ω», categoría `DeveloperTool` + descripciones. |
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
cargo test -p bara                # 110 pruebas (59 unitarias + 51 de integración)

# ── IDE: aval completo del workspace ────────────────────────────────────────
cargo check  --workspace
cargo test   -p bara -p bara-ide --features bara-ide/serde   # kernel (110) + motor del IDE (34)
cargo clippy --workspace --all-targets                       # solo verifica: clippy no enlaza
cargo run    -p bara-ide -- samples\genesis.bara             # CLI: --tokens | --summary | --help | --version

# ── Interfaz ────────────────────────────────────────────────────────────────
npm run typecheck       # tsc --noEmit
npm run test:ai         # 12 comprobaciones del panel de IA, sin red
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

Aquel día el árbol quedó **limpio** (`git status --short` sin salida) y `main` al día con `origin/main`, con el
kernel **`BAR` sin cambios**.

**Actualización (14/10/2026, 22:08 UTC): release publicado.** Aquel *staging* (7 ficheros en el kernel y 10 en el
IDE) se convirtió en dos commits, empujados a `origin`:

| Repo | Rama | Commit | Contenido | Push |
|---|---|---|---|---|
| `BAR` | `dev` | `1e3d3f6` | `feat(aether-omega): consolidacion final del constructor visual, paridad TLS y documentacion de inventario (110/144)` — 7 ficheros, +3344/−49 (incluye `src/visual_builder.rs`) | `d6b4f56..1e3d3f6  dev -> dev` |
| `bara-ide` | `main` | `7925298` | `feat(ide): integracion del motor visual AETHER-Omega y actualizacion de inventario` — 10 ficheros, +2102/−75 (incluye `src/visual.rs`, `web/src/visual.ts`, `VisualBuilder.tsx`, `docs/VISUAL_BUILDER.md`) | `4f03fd5..7925298  main -> main` |

- Ambos árboles quedan **limpios**: `## dev...origin/dev` y `## main...origin/main`, sin entradas de cambios.
- **CI remota del kernel**: [`run 38645547477`](https://github.com/usercardjoke1036991-star/Bara-AETHER--Engine-Final-Expansion/actions/runs/38645547477) → **success** en los cinco trabajos (lints 20 s · Windows `release` 2 m 55 s · Ubuntu `debug` 24 s · Windows `debug` 1 m 5 s · Ubuntu `release` 1 m 18 s). El repositorio del IDE **no tiene workflows**.
- **PR de promoción**: [`#2 dev → main`](https://github.com/usercardjoke1036991-star/Bara-AETHER--Engine-Final-Expansion/pull/2), abierto. GitHub lo marca **`CONFLICTING`**: `main` conserva el *squash* del PR #1 (`4c8289a`, ausente en `dev`) y la sonda `git merge-tree` localiza tres conflictos — `.github/workflows/ci.yml` (*add/add*), `README.md` y `tests/integration_suite.rs`—, mientras que `src/lib.rs`, `src/runtime.rs`, `src/repl.rs`, `src/main.rs` y `src/ffi_ingest.rs` fusionan solos. Como `dev` es la línea autoritativa, se resuelve conservando la versión de `dev` en esos tres ficheros antes de fusionar.

Estado **previo al commit** (medido hoy, `git status --short`):

```
bara-ide>  M README.md  M docs/INVENTARIO.md  M src-tauri/src/lib.rs  M src/lib.rs  M web/src/App.tsx  M web/src/styles.css
bara-ide> ?? docs/VISUAL_BUILDER.md  ?? src/visual.rs  ?? web/src/components/VisualBuilder.tsx  ?? web/src/visual.ts
BAR>       M .github/workflows/ci.yml  M README.md  M src/crypto_native.rs  M src/ffi_ingest.rs  M src/lib.rs  M src/net_camouflage.rs
BAR>       ?? src/visual_builder.rs
```

Ramas: `bara-ide` en **`main`** y `BAR` en **`dev`**. La capa AETHER‑Ω del IDE (`src/aether.rs`, `web/src/aether.ts`,
`KernelPanel.tsx`, `KernelCards.tsx`) ya estaba commiteada y no aparecía en la lista.

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
| Módulos del kernel | 17 (+ `lib`/`main`): 10 del núcleo + `fractal_geometry` + 5 de la capa AETHER‑Ω + `visual_builder` |
| Binarios | **4 ejecutables**: `bara`, `bara_oracle`, `bara-ide` (CLI), `bara-ide-desktop` |
| Fases del génesis | 13 |
| Meta‑comandos del oráculo | 11 variantes (`10` + `Unknown`) con alias en español e inglés |
| Clases de `TokenKind` | 16 |
| Raíces semánticas | 6 |
| Valencias de Belnap | 4 |
| Comandos IPC | 25 |
| Funciones del cliente IPC (`engine.ts`) | 15 (+ `aether.ts` 551 líneas · `visual.ts` 198) |
| Componentes React | 6 + `App`/`SummaryPanel` |
| Módulos de IA | 6 (1 418 líneas) |
| Pruebas | kernel **110** (59 unitarias + 51 de integración) · motor del IDE **34** · autodiagnóstico IA **11** |
| Dependencias externas del kernel | **0** (`std` puro) |
| `unsafe` en el kernel | **0** |
| Líneas de Rust del IDE | **4 343** (motor 3 831 + backend 322 + `build.rs` 190) |
| Líneas del kernel | **18 794** de código (`src/` + `src/bin/`) + **2 611** de pruebas (`tests/`) |
| Idiomas del oráculo | entrada/salida en español, inglés y hebreo (alias plegados sin acentos) |

---

*Documento generado por reconocimiento de solo lectura sobre el árbol real; todos los nombres, rutas y recuentos
proceden de los ficheros citados. **Actualizado el 14/10/2026** con la capa AETHER‑Ω, el constructor visual y los
recuentos que devuelve `cargo test` en esta máquina (`bara` 110 = 59 + 51 · `bara-ide` 34 · workspace 144). Las
discrepancias con la documentación anterior quedan corregidas aquí: el README del IDE anunciaba **11** pruebas del
motor (hoy **34**) y el kernel ha pasado de 11 a **17** módulos, con **25** comandos IPC.*

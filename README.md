# Bara IDE — escritorio (Tauri v2 + React + TypeScript)

Aplicación de escritorio del IDE para el lenguaje **Bara** (*Shoresh*,
AETHER‑Ω). Envuelve el **kernel congelado** `bara` (etiqueta `v0.1.0-kernel`)
sin reimplementar nada y expone su análisis léxico a una interfaz React.

## Arquitectura (una sola dirección, cero duplicación)

```
web/  (React + TS)  --IPC-->  src-tauri/  -->  bara-ide (lib)  -->  bara (kernel)
 interfaz gráfica             comandos           modelo de análisis       lexer Shoresh
                              #[tauri::command]   (serializable)           congelado
```

| Capa | Crate / carpeta | Responsabilidad |
| --- | --- | --- |
| Kernel | `../BAR` (miembro `BAR`) | Lexer *Shoresh*, tipos `Token` / `TokenKind` / `Keyword`. **No se toca.** |
| Motor | `bara-ide` (lib + CLI) | Proyecta el lexer a un modelo de documento (`Analysis`). Cero dependencias externas salvo la *feature* `serde` opcional. |
| Backend | `bara-ide/src-tauri` (`bara-ide-desktop`) | Comandos Tauri que devuelven el modelo como JSON. |
| Interfaz | `bara-ide/web` | React 19 + Vite 7 + TypeScript 5. |

## Estructura

```
bara-ide/
├── Cargo.toml              paquete `bara-ide`: biblioteca + CLI
├── docs/INVENTARIO.md      inventario funcional del workspace completo (kernel + IDE)
├── src/
│   ├── lib.rs              modelo (tokens, resumen, inventario), informes y pruebas
│   └── main.rs             CLI histórica: `--tokens` / `--summary` / `--help` / `--version`
├── samples/genesis.bara    documento Shoresh de ejemplo (embebido en el binario)
├── package.json            front-end (React, Vite, TS) + CLI de Tauri
├── vite.config.ts          Vite sirve `web/` (en `src/` vive Rust)
├── tsconfig.json
├── web/                    interfaz gráfica
│   ├── index.html
│   ├── scripts/ai-check.mjs    autodiagnóstico del panel de IA, en Node
│   └── src/
│       ├── {main,App}.tsx, engine.ts, styles.css, vite-env.d.ts
│       ├── ai/             cliente de IA: tipos, ajustes, proveedores, prompt, imágenes, autodiagnóstico
│       └── components/     ChatPanel, AiSettings, AssistantText
└── src-tauri/              backend Tauri v2 (crate miembro del workspace)
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── icons/ (png + ico + icns)
    └── src/{lib,main}.rs
```

## Comandos IPC

| Comando | Entrada | Salida |
| --- | --- | --- |
| `analyze_source` | `{ source: string }` | `Analysis` (siempre `Ok`: el lexer del kernel es total) |
| `analyze_file` | `{ path: string }` | `Analysis` o error legible |
| `read_document` | `{ path: string }` | texto del `.bara` (para el editor) |
| `kernel_catalogue` | — | las seis raíces semánticas del kernel (glifo + significado) |
| `sample_genesis` | — | `samples/genesis.bara` embebido en el binario |
| `shoresh_translate` | `{ text: string }` | `Translation`: programa *Shoresh*, raíces usadas y cuántas hubo que sintetizar (traduce el **léxico del kernel**, no la interfaz) |
| `oracle_converse` | `{ input: string }` | `TurnResult`: turno del **oráculo** del kernel, `Δ⁻¹` aplicados y estado de la sesión |
| `oracle_status` | — | `SessionStatus`: informe del oráculo, pilas, diario `Δ⁻¹`, memoria holográfica, mutador y malla |
| `oracle_turns` | — | turnos conversados, en orden |
| `oracle_reset` | — | cierra la sesión y devuelve el estado virgen |
| `temporal_deltas` | — | diario temporal `Δ⁻¹` completo (`DeltaView[]`) |
| `temporal_rollback` | `{ marker: number }` | **control temporal**: rebobina `Δ⁻¹` hasta un marcador (`TurnResult`) |
| `belnap_lattice` | — | tablas `∧`, `∨` y negación de la **biláttice de Belnap** |
| `belnap_evaluate` | `{ truth: number, falsity: number }` | clasifica un par `(⊤, ⊥)` con el umbral de designación del kernel |

El contrato está tipado **a ambos lados**: `web/src/engine.ts` replica el modelo
Rust (nombres `camelCase` de `serde`), de modo que `tsc` verifica el IPC.

### Sesión del oráculo, Belnap y control temporal

Los tres servicios del núcleo que gobiernan la semántica se exponen **sin
duplicar ni un literal ni un tipo**:

| Servicio | De dónde sale | Qué publica |
| --- | --- | --- |
| **Oráculo** | `bara::repl::Oracle` (el mismo del REPL y del binario `bara_oracle`) | turnos, intención, programa *Shoresh* compilado y respuesta |
| **Belnap** | `bara::runtime::QuantumState::{belnap, observe, conjunction, disjunction, negate}` | las cuatro valencias `⊤`, `⊥`, `⊤∧⊥`, `∅`, sus masas y la biláttice completa |
| **Control temporal** | `BaraRuntime.timeline` (`TemporalEngine`, `Marker`) | marcadores, diario `Δ⁻¹`, rebobinados y las métricas del runtime |

* La sesión guarda su **guion** y los marcadores rebobinados, y lo reproduce con
  `Oracle::converse` en cada consulta. Es **determinista** (los comandos meta
  `:estado`, `:deshacer`… se comportan igual que en el REPL, incluido el `Δ⁻¹`
  manual) y no necesita préstamos del runtime: sin `unsafe` ni auto-referencias.
* Lo único **NO DETERMINISTA** son los campos `micros`/`atMicros` y las
  respuestas que citan tiempos (p. ej. `:deshacer`), tal como exige el matiz A7
  del kernel: son informativos y nunca participan en comparaciones.
* El panel «Oráculo del kernel» de la interfaz usa estos comandos: conversa,
  captura un marcador, rebobina con `Δ⁻¹` y pinta la biláttice de Belnap que
  calcula el núcleo.

## Puesta en marcha

```powershell
cd C:\Users\Vexor\Downloads\bara-ide
npm install
npm run tauri dev      # ventana del IDE con recarga en caliente
npm run tauri build    # instalador (en Windows requiere el toolchain MSVC)
```

CLI clásica (sin interfaz gráfica), desde el raíz del workspace:

```powershell
cargo run -p bara-ide -- bara-ide/samples/genesis.bara
```

## Panel de IA (texto + imágenes)

Botón **«asistente»** de la barra superior: abre un panel lateral con un chat
multimodal. El panel **no sabe nada del lenguaje**: todo el conocimiento viaja
desde el kernel por IPC.

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Contrato | `web/src/ai/types.ts` | Tipos puros (`AiConfig`, `ChatMessage`, `ImageAttachment`…). |
| Ajustes | `web/src/ai/config.ts` | Fábrica → almacén del navegador → entorno; enmascarado y validación. |
| Proveedores | `web/src/ai/providers.ts` | Construcción de peticiones y análisis de respuestas (puras, sin red). |
| Contexto | `web/src/ai/prompt.ts` | Prompt del sistema con el catálogo, el análisis y el ejemplo del kernel. |
| Imágenes | `web/src/ai/images.ts` | Arrastrar/soltar, pegar y elegir; reducción a 1568 px y topes de tamaño. |
| Autodiagnóstico | `web/src/ai/selfcheck.ts` | Once comprobaciones sin red: ajustes, peticiones, respuestas, prompt, imágenes. |
| Interfaz | `web/src/components/*.tsx` | `ChatPanel` (panel y conversación), `AiSettings` (ajustes), `AssistantText` (prosa y bloques de código). |

* **Proveedores**: Anthropic (Messages API) y OpenAI (Chat Completions). La
  cabecera `anthropic-dangerous-direct-browser-access` es obligatoria para que
  un WebView pueda hablar con Anthropic; en la petición multimodal **la imagen
  precede al texto** (es el orden que exige el contrato).
* **Claves**: se escriben en «Ajustes › IA». Por defecto viven **sólo en la
  sesión**; marcar «recordar la clave» las guarda en el almacén del navegador,
  y «Olvidar» las borra. La clave nunca se incluye en un informe de error ni en
  la descripción del estado. `VITE_ANTHROPIC_API_KEY` / `VITE_OPENAI_API_KEY`
  (véase `.env.example`) existen **sólo para desarrollo** y quedan incrustadas
  en el haz que sirve Vite: no son un mecanismo de custodia. Para un despliegue
  real, apunte el campo «raíz de la API» a un proxy propio que firme las
  peticiones.
* **Cómo llega el código al editor**: los bloques cercados (```) de cada
  respuesta se pueden copiar o enviar al editor con «usar en el editor». El
  bloque se **añade** al final del documento, nunca lo sustituye, y el kernel lo
  vuelve a analizar en 200 ms.
* **Traducción a Shoresh**: el botón «Shoresh» de cualquier mensaje (y el del
  redactor) llama a `shoresh_translate`, es decir, al mismo traductor del REPL
  del kernel. Si el léxico desconoce una raíz, el oráculo la sintetiza y el
  panel lo dice con el número de síntesis.
* **Autodiagnóstico**: botón «Autodiagnóstico» del panel, o `npm run test:ai`
  (idénticas comprobaciones, ejecutadas en Node).

## Verificación

```powershell
cargo check  --workspace                                    # aval del workspace completo
cargo test   -p bara -p bara-ide --features bara-ide/serde   # kernel (40 pruebas) + motor del IDE (11)
cargo clippy --workspace --all-targets                      # sólo verifica: clippy no enlaza
npm run typecheck                                           # tsc --noEmit
npm run test:ai                                             # 11 comprobaciones del panel de IA, sin red
npm run build                                               # tsc --noEmit && vite build -> web/dist
```

La feature `serde` se pide a mano para que `cargo test` construya el motor tal y
como lo consume el backend (si no, la prueba que fija el contrato IPC con
`web/src/engine.ts` queda fuera). `cargo test --workspace` haría además los
*harneses* del backend de escritorio: enlazar ese binario de Tauri exige un
enlazador MinGW/MSVC completo — aquí `ld` aborta con `export ordinal too large`
y el disco está al límite —, así que las pruebas se ejecutan sobre el kernel y
el motor, y el backend se cubre con `cargo check` y `cargo clippy`.

## Notas

* **Toolchain de Windows**: el árbol completo de Tauri v2 **verifica**
  (`cargo check`) con el toolchain `x86_64-pc-windows-gnu` (MinGW/`rust-lld`),
  que es el único instalado con `std` en esta máquina. Para *enlazar* el
  instalador se recomienda MSVC (`rustup default stable-x86_64-pc-windows-msvc`),
  que es el soportado oficialmente por Tauri.
* **Recurso de Windows (icono/manifiesto)**: `tauri-build` lo embebe con
  `windres` (GNU) o `rc.exe` (MSVC). El toolchain GNU de rustup **no** trae
  MinGW, y en esta máquina no hay `windres`/`llvm-windres`/`rc.exe`, así que
  `src-tauri/build.rs`:
  1. respeta `RC`/`RC_<TARGET>`/`RC_<TARGET_CON_GUIONES>` si están definidos;
  2. si no, autodetecta `windres` en el `PATH` y en las raíces usuales de
     MinGW/MSYS2 y lo publica en `RC`;
  3. si no encuentra ninguno, degrada ese único paso a un `cargo:warning`
     (sin pánico) porque el recurso sólo afecta al **enlazado** del `.exe`,
     no a `cargo check`.

  Es decir: `cargo check` es válido aquí tal cual; para obtener un `.exe`
  completo, aporte el compilador de recursos (MSVC o `windres`).
* **CSP**: `tauri.conf.json` usa `"csp": null` (igual que la plantilla oficial)
  para no romper el HMR de Vite en desarrollo. Endurecerla es un cambio de una
  línea antes de publicar.
* **Perfil release**: se declara en el `Cargo.toml` del raíz del workspace
  (idéntico al de `BAR`); Cargo ignora el de los miembros no raíz a propósito.
* **Iconos**: generados con `System.Drawing` (PNG 32/128/256/512, ICO
  multi-tamaño 16→256 e ICNS con la entrada `ic08`).

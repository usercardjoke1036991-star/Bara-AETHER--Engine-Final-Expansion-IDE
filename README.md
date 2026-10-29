# Bara IDE — escritorio (Tauri v2 + React + TypeScript)

Aplicación de escritorio del IDE para el lenguaje **Bara** (*Shoresh*,
AETHER‑Ω). Envuelve el kernel `bara`. La etiqueta `v0.1.0-kernel` es la
identidad congelada del lenguaje; el crate publicado está en `0.5.0`. No
reimplementa el lexer y expone su análisis a una interfaz React.

Para compilar hace falta el repositorio del kernel como carpeta hermana
`../BAR` (desde `src-tauri`, `../../BAR`). El `Cargo.toml` de workspace que
agrupa los dos vive en la máquina de desarrollo y no está en este repo. La CI
clona el kernel en un commit fijo y crea ese enlace.

## Arquitectura (una sola dirección, cero duplicación)

```
web/  (React + TS)  --IPC-->  src-tauri/  -->  bara-kernel-host  -->  bara (kernel)
 interfaz gráfica             supervisor          proceso hijo              lexer Shoresh
                              #[tauri::command]   JSON por stdin/stdout     congelado
```

| Capa | Crate / carpeta | Responsabilidad |
| --- | --- | --- |
| Kernel | `../BAR` (miembro `BAR`) | Lexer *Shoresh*, tipos `Token` / `TokenKind` / `Keyword`. **No se toca.** |
| Motor | `bara-ide` (lib + CLI) | Proyecta el lexer a un modelo de documento (`Analysis`). Cero dependencias externas salvo la *feature* `serde` opcional. |
| Backend | `bara-ide/src-tauri` (`bara-ide-desktop`) | Comandos Tauri. El kernel corre en el proceso hijo. |
| Proceso | `bara-ide/kernel-host` (`bara-kernel-host`) | Sidecar: una operación JSON por línea, sin red ni shell. |
| Interfaz | `bara-ide/web` | React 19 + Vite 7 + TypeScript 5. |

## Estructura

```
bara-ide/
├── Cargo.toml              paquete `bara-ide`: biblioteca + CLI
├── docs/INVENTARIO.md      inventario funcional del workspace completo (kernel + IDE)
├── docs/VISUAL_BUILDER.md  contrato del constructor visual (lienzo → Shoresh firmado)
├── scripts/
│   └── build_android.ps1   APK/AAB: resuelve SDK/NDK/JDK y ejecuta Gradle + Cargo
├── src/
│   ├── lib.rs              modelo (tokens, resumen, inventario), informes y pruebas
│   ├── aether.rs           paneles AETHER‑Ω: autopoiesis, registro cuántico, malla, Metal‑IR, fractales, diario Δ⁻¹
│   ├── visual.rs           constructor visual: lienzo del IDE → `bara::visual_builder`, con sello
│   ├── bridge.rs           puente FASE 5: manifiesto e instantánea de `bara::ide_bridge`
│   └── main.rs             CLI histórica: `--tokens` / `--summary` / `--help` / `--version`
├── samples/genesis.bara    documento Shoresh de ejemplo (embebido en el binario)
├── kernel-host/            proceso hijo del kernel (`bara-kernel-host`)
│   ├── Cargo.toml
│   └── src/{lib,dispatch,supervisor,main}.rs
├── package.json            front-end (React, Vite, TS) + CLI de Tauri
├── vite.config.ts          Vite sirve `web/` (en `src/` vive Rust)
├── tsconfig.json
├── .cargo/config.toml      runner GNU: manifiesto/iconos/WebView2 en pruebas (CWD = bara-ide/)
├── web/                    interfaz gráfica
│   ├── index.html
│   ├── scripts/ai-check.mjs    autodiagnóstico del panel de IA, en Node
│   └── src/
│       ├── {main,App}.tsx, engine.ts, aether.ts, visual.ts, bridge.ts, styles.css, vite-env.d.ts
│       ├── ai/             cliente de IA: tipos, ajustes, proveedores, prompt, imágenes, autodiagnóstico
│       └── components/     ChatPanel, AiSettings, AssistantText, KernelPanel, KernelCards, VisualBuilder
└── src-tauri/              backend Tauri v2 (crate miembro del workspace)
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── .cargo/config.toml   runner + rustflags GNU para `cargo run` desde src-tauri/
    ├── scripts/win-gnu-recursos.py  manifiesto + iconos + WebView2Loader (GNU)
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
| `autopoiesis` | `{ source: string }` | `AutopoiesisReport`: mutador autopoiético, valencia por axioma y puerta ZK (`ZkGateView`) |
| `quantum_native` | `{ source: string }` | `QuantumView`: banco de qubits, amplitudes, entrelazamiento y par de Bell |
| `mesh_sync` | `{ source, peers, rounds, threaded }` | `MeshView`: malla holográfica con relojes vectoriales y digest |
| `metal_ir` | `{ source, device? }` | `MetalView`: programa Metal‑IR (operaciones, registros y bypass del driver) |
| `temporal_timeline` | `{ source: string }` | `TimelineView`: diario `Δ⁻¹`, pila de estados y paradojas |
| `fractal_memory` | `{ source: string }` | `FractalMemoryView`: reparto áureo/Fibonacci de la memoria del documento |
| `fractal_plan` | `{ widths: number[] }` | `FractalMemoryView`: reparto áureo de una lista de anchos |
| `visual_catalogue` | — | `VisualCatalogueView`: clases de bloque, tipos y cotas del lienzo, servidos por el kernel |
| `visual_sample` | — | lienzo de ejemplo embebido en el kernel (`SAMPLE_BLUEPRINT`) |
| `visual_build` | `{ blueprint: string }` | `VisualBuildView` o error legible: contrato estricto de todo o nada |
| `visual_compose` | `{ blueprints: string[] }` | `VisualBuildView` del ADN compuesto (el orden de los lienzos importa) |
| `bridge_manifest` | — | contrato del puente (`bara::ide_bridge::Manifest::canon`): esquema, versión, secciones, cotas y huella |
| `bridge_snapshot` | `{ source: string }` | instantánea de sólo lectura: identidad, inmunidad, pasarela y núcleo, con el veredicto del documento |

El contrato está tipado **a ambos lados**: `web/src/engine.ts`, `web/src/aether.ts`,
`web/src/visual.ts` y `web/src/bridge.ts` replican el modelo Rust (nombres
`camelCase` de `serde`, salvo el puente, que el núcleo escribe en `snake_case`
sin `serde`), de modo que `tsc` verifica el IPC.

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

## Capa AETHER‑Ω y constructor visual

Dos paneles más de la barra superior, ambos servidos por el **mismo kernel**:

| Botón | Panel | Pieza de la interfaz | Qué publica el núcleo |
| --- | --- | --- | --- |
| «AETHER‑Ω» | `KernelPanel` + `KernelCards` | `web/src/aether.ts` → `src/aether.rs` | autopoiesis y puerta ZK, registro cuántico, malla holográfica, Metal‑IR, diario `Δ⁻¹` y memoria fractal |
| «lienzo visual» | `VisualBuilder` | `web/src/visual.ts` → `src/visual.rs` | el lienzo JSON traducido a *Shoresh*, **firmado** y auditado (retícula áurea, riesgo, cotas) |

* Todo lo que se pinta —clases de bloque, tipos, cotas, valencia, grafo, informe—
  lo decide el kernel: la interfaz edita texto, pide y formatea, y no repite un
  solo literal del contrato.
* El **constructor visual** pide primero el contrato del lienzo
  (`visual_catalogue`) y el ejemplo del núcleo (`visual_sample`), traduce con un
  retardo de 300 ms (una llamada por pausa, no por tecla) y compone hasta
  `MAX_COMPOSED_CANVASES` (8) lienzos en un único ADN `:compuesto`.
* El ADN se firma con la semilla **fija** del IDE (`VISUAL_KEY_SEED`): el sello
  prueba **integridad y reproducibilidad**, no identidad de usuario — es una
  limitación declarada, no una custodia de clave.
* El **puente de la FASE 5** (`bridge_manifest` / `bridge_snapshot`) reenvía los
  documentos de `bara::ide_bridge` **byte a byte** (claves fijas en
  `snake_case`). La instantánea se captura sobre un kernel vivo en el que el
  documento del editor ha entrado por la pasarela de burbujas y el sistema
  inmunitario adaptativo lo ha escaneado: la tarjeta pinta el veredicto, el
  peligro y las marcas que calculó el **núcleo**. Sus únicas alertas son de
  **contrato** (deriva de esquema o de huella, sección ausente): nunca
  reinterpreta un veredicto ni aplica umbrales propios.
* Contrato completo del lienzo (claves, clases, tipos, cotas, informe y
  limitaciones): `docs/VISUAL_BUILDER.md`.

## Puesta en marcha

```powershell
cd C:\Users\Vexor\Downloads\bara-ide
npm install
npm run tauri dev      # ventana del IDE con recarga en caliente
npm run tauri build    # instaladores MSI + NSIS en ..\target\release\bundle
```

En esta máquina el único toolchain con `std` es `x86_64-pc-windows-gnu`.
`tauri-build` no encuentra `windres`, así que el enlazado produce un `.exe`
sin recursos y `src-tauri/scripts/win-gnu-recursos.py` los embebe después:
manifiesto Common Controls 6.0, iconos y `WebView2Loader.dll`. Es idempotente
y `--probar` arranca el binario para comprobar que sobrevive:

```powershell
python src-tauri/scripts/win-gnu-recursos.py --exe ..\target\release\bara-ide-desktop.exe
python src-tauri/scripts/win-gnu-recursos.py --exe ..\target\release\bara-ide-desktop.exe --probar 20
```

`npm run tauri build` aplica ese parche automáticamente mediante
`beforeBundleCommand` (`npm run patch:resources`), que se ejecuta **de forma
síncrona entre el enlazado y el empaquetado**. No dependas del parche de
`build.rs`: éste espera al enlazador en segundo plano y el bundler puede copiar
el `.exe` antes de que termine; el hook elimina esa carrera. Si empaquetas con
otra herramienta, ejecuta el comando a mano antes de copiar el binario.

### Android (APK / AAB)

El contenedor Gradle vive en `src-tauri/gen/android`; sus artefactos
(`build/`, `.gradle/`, `local.properties`, `keystore.properties`, `jniLibs/`)
están ignorados. Hacen falta JDK 17+ (`JAVA_HOME`), Android SDK
(`ANDROID_HOME`), NDK r27 (`NDK_HOME` o `%ANDROID_HOME%\ndk\<versión>`), los
targets Rust de Android y `cargo` en el `PATH`.

```powershell
.\scripts\build_android.ps1                                   # APK debug, arm64
.\scripts\build_android.ps1 -Profile release -Format apk      # APK release
.\scripts\build_android.ps1 -Profile release -Format aab `
    -Targets aarch64,armv7,i686,x86_64                        # AAB universal
```

El guion resuelve SDK/NDK/JDK, instala los targets Rust que falten, compila el
frontend con `npm run build` y ejecuta directamente la tarea Gradle
(`assembleArm64Debug`, `bundleUniversalRelease`, etc.). **No invoca la CLI de
Tauri**: en Windows ésta usa `cargo-mobile2`, que crea un enlace simbólico para
`jniLibs` y falla sin Developer Mode (`CreateProcess error=2`). En su lugar,
`scripts/android/BuildTask.kt` (que `buildSrc` compila directamente, sin
una segunda copia) compila la biblioteca con
`cargo build --lib --target <triple>`, configura el enlazador del NDK y copia
`libbara_ide_desktop_lib.so` a `app/src/main/jniLibs/<abi>`. Los artefactos
quedan en `src-tauri/gen/android/app/build/outputs/{apk,bundle}`.

Para publicar en Google Play, crea `src-tauri/gen/android/keystore.properties`
con el keystore real (el archivo está ignorado por git) y añade la
`signingConfig` correspondiente en `app/build.gradle.kts`; Gradle genera el AAB
release sin firmar si no hay configuración de firma.

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
| Ajustes | `web/src/ai/config.ts` | Fábrica y almacén sin secreto; validación de la raíz. |
| Llavero | `web/src/ai/keyring.ts` | Guardar, existir y borrar. El secreto no vuelve. |
| Proveedores | `web/src/ai/providers.ts` | Construcción de peticiones y análisis de respuestas (puras, sin red). |
| Contexto | `web/src/ai/prompt.ts` | Prompt del sistema con el catálogo, el análisis y el ejemplo del kernel. |
| Imágenes | `web/src/ai/images.ts` | Arrastrar/soltar, pegar y elegir; reducción a 1568 px y topes de tamaño. |
| Autodiagnóstico | `web/src/ai/selfcheck.ts` | Catorce comprobaciones sin red: ajustes, peticiones, respuestas, prompt, imágenes, transporte Rust, el reintento del chat y el descarte del análisis viejo. |
| Interfaz | `web/src/components/*.tsx` | `ChatPanel` (panel y conversación), `AiSettings` (ajustes), `AssistantText` (prosa y bloques de código). |

* **Proveedores**: Anthropic (Messages API) y OpenAI (Chat Completions, también
  DeepSeek). La petición la arma el WebView sin clave. El proceso añade la
  cabecera y llama a la red con **ureq + rustls** (almacén de certificados del
  sistema; ver `docs/AI_TRANSPORT.md`). «Probar conexión» diagnostica
  DNS→TCP→TLS→HTTP. En la petición multimodal **la imagen precede al texto**.
* **Claves**: se escriben en «Ajustes › IA». El campo es un borrador: al
  guardar sale de la interfaz. «Recordar» las deja en el llavero del sistema
  (Credential Manager en Windows, Keychain en macOS, Secret Service en Linux).
  Sin esa marca viven sólo en la memoria del proceso. «Olvidar» las borra de
  los dos sitios. Una clave que todavía estuviera en `localStorage` se mueve
  al llavero y se borra del WebView. No hay variables `VITE_*` de clave: el
  haz no puede llevar un secreto. La raíz tiene que ser uno de los tres hosts
  oficiales o HTTP en la máquina local; otro host no sale del proceso.
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
cargo check  --workspace --all-targets                       # aval del workspace completo
cargo test   --workspace --locked                            # kernel + motor + backend de escritorio
cargo clippy --workspace --all-targets --locked -- -D warnings  # política del CI: salida 0 y 0 avisos de rustc
                                                                # (solo el aviso esperado del build.rs de Tauri)
npm run typecheck                                           # tsc --noEmit
npm run test:ai                                             # 14 comprobaciones del panel de IA, sin red
npm run build                                               # tsc --noEmit && vite build -> web/dist
```

`cargo test --workspace` incluye también los *arneses* del backend de
escritorio. En Windows GNU el `.exe` de prueba debe llevar embebido el
manifiesto Common-Controls 6.0 (`TaskDialogIndirect`); de eso se encarga el
runner de `.cargo/config.toml`, que además copia `WebView2Loader.dll` junto al
binario. Por eso las pruebas del backend se ejecutan de verdad, no sólo se
verifican con `cargo check`.

Estado medido en esta máquina con `cargo test --workspace --locked`: `bara`
**345 / 345** (249 unitarias + 96 de integración), **2 / 2** doctests,
`bara-ide` **40 / 40**, `bara-ide-desktop` **6 / 6**, workspace **393 / 393** y
0 fallos. `cargo clippy --workspace --all-targets --locked -- -D warnings`
termina con salida 0.

## Compilar en Windows

El target es `x86_64-pc-windows-gnu`. El transporte de IA usa **rustls** →
crate **ring**, que necesita un compilador C real al construir.

1. Instala **LLVM MinGW (UCRT)**, por ejemplo:
   `winget install --id MartinStorsjo.LLVM-MinGW.UCRT -e`
   o descarga el zip desde
   [mstorsjo/llvm-mingw](https://github.com/mstorsjo/llvm-mingw/releases)
   y descomprímelo (p. ej. en `%USERPROFILE%\Downloads\llvm-mingw\…\bin`).
2. Apunta el compilador de C **sin** poner ese `bin` delante del PATH del
   enlazador de rustup (si lo pones primero, rompe `-lgcc`). En PowerShell,
   antes de `cargo` / `npm run dist:windows`:

```powershell
$llvm = "$env:USERPROFILE\Downloads\llvm-mingw\llvm-mingw-*-ucrt-x86_64\bin"
$llvm = (Resolve-Path $llvm).Path
$sc = "$env:USERPROFILE\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained"
$env:CC  = Join-Path $llvm 'gcc.exe'
$env:CXX = Join-Path $llvm 'g++.exe'
$env:AR  = Join-Path $llvm 'llvm-ar.exe'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $sc 'x86_64-w64-mingw32-gcc.exe'
```

3. **No uses** el stub `C:\mingw64\bin\gcc.cmd`: sólo sirve de preprocesador
   para `windres` y **no** compila C. Con ese stub, `ring` falla con
   `failed to find tool "gcc.exe"`.

En CI (ubuntu-latest) `build-essential` aporta `gcc` y ring se compila sin
pasos extra; el workflow no necesita MinGW.

## Notas

* **Toolchain de Windows**: el árbol completo de Tauri v2 **verifica** y
  **enlaza** con `x86_64-pc-windows-gnu` (MinGW/`rust-lld`), el único con `std`
  en esta máquina. `build.rs` busca `windres`/`llvm-windres`; si no existe,
  deja un proceso suelto que espera al enlazador y llama a
  `src-tauri/scripts/win-gnu-recursos.py`, que embebe el manifiesto Common
  Controls 6.0 y los iconos, y copia `WebView2Loader.dll`. `cargo run` y
  `tauri dev` aplican el parche de forma determinista antes de lanzar la app
  mediante el runner de `src-tauri/.cargo/config.toml`. Para que los comandos
  documentados funcionen desde la raíz del repo, `.cargo/config.toml` declara
  el mismo runner; y si `cargo` se invoca desde el workspace contenedor
  (`../`), la configuración de esa raíz debe declararlo también (Cargo sólo
  descubre `.cargo/config.toml` subiendo desde el CWD, nunca entrando en los
  directorios de los miembros). Con MSVC o `windres` disponible se usa el
  compilador de recursos normal y el parcheador es idempotente.
* **CSP**: `tauri.conf.json` no usa `"csp": null`. En producción, `connect-src`
  admite `'self'`, `ipc:`, `http://ipc.localhost`, `http://localhost:*`,
  `http://127.0.0.1:*` y sólo `https://api.anthropic.com`,
  `https://api.openai.com` y `https://api.deepseek.com`. No hay un esquema
  `https:` suelto. `devCsp` añade el servidor de Vite (`http://localhost:1420`
  y `ws://localhost:1420`) y los mismos tres orígenes. Las recetas cortan
  `typecheck` a los 60 s y `cargo check` / `cargo test` a los 120 s.
* **Perfil release**: se declara en el `Cargo.toml` del raíz del workspace
  (idéntico al de `BAR`); Cargo ignora el de los miembros no raíz a propósito.
* **Iconos**: generados con `System.Drawing` (PNG 32/128/256/512, ICO
  multi-tamaño 16→256 e ICNS con la entrada `ic08`).

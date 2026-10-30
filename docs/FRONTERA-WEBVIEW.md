# Frontera de confianza del WebView

El shell de escritorio (`bara-ide-desktop`, Tauri v2) no es un sandbox del sistema operativo. Es una jaula de rutas delante de un motor que no lee el disco.

## Qué confina `ActiveWorkspace`

La raíz activa es una ruta canónica. La instalan `workspace_open_dialog` y `github_clone`. `workspace_tree`, `workspace_read_document` y `workspace_write_document` no aceptan una raíz: leen y escriben sólo dentro de la que ya está activa.

`analyze_file` y `read_document` no eligen otra raíz: abren sólo un `.bara` que, ya canonizado, queda dentro de esa raíz.

Antes de tocar el disco se rechaza `..` y cualquier componente que no sea un nombre normal. Después se canoniza (enlaces incluidos) y el resultado tiene que cumplir `starts_with` sobre la raíz. El guardado del editor escribe `.bara`. `judge_auto_patch` **no escribe**: sólo juzga y devuelve diff. La escritura exige `confirm_auto_patch` tras aceptar el diff (juicio `⊤`, léxico verificado); `∅` jamás se aplica. Antes de escribir se crea un respaldo bajo `.bara-backup/` y `undo_auto_patch` puede restaurarlo. El árbol no sigue enlaces simbólicos, recanoniza cada carpeta, salta `target/`, `node_modules/`, `.git/` y `.bara-backup/`, y corta a profundidad 24.

## Qué confía en el WebView

Cada ventana tiene su propia capability en `src-tauri/capabilities/` (etiqueta exacta, sin `*`). Los permisos de los 61 comandos viven en `src-tauri/permissions/` (grupos `kernel`, `archivos`, `llavero`, `recetas`, `ventanas`/`medios`, `github`). La ACL de Tauri es la primera capa; los comandos sensibles (`ai_key_*`, `ai_exchange`, escritura, `judge_auto_patch`, recetas, `github_clone`, `idle_apply`) comprueban además `window.label()` en Rust. Ninguna ventana recibe `shell:*` ni spawn. El llavero y `ai_exchange` sólo en `main` y `ai-workspace` (ambas alojan el chat). Escritura, recetas y clon sólo en `main`. La CSP de producción permite `self`, el canal IPC local (`ipc:` y `http://ipc.localhost`), `http://localhost:*` y `http://127.0.0.1:*`. No nombra hosts HTTPS de proveedores y no admite el esquema suelto `https:`. La CSP de desarrollo añade `http://localhost:1420` y `ws://localhost:1420`. El análisis, el oráculo, los paneles, el lienzo, el puente, el cockpit, el autocompletado, la topología, el juez, los pesos locales, la transmutación y el reposo salen por el proceso hijo `bara-kernel-host`. Archivos, recetas, el clon, el llavero y la red de la IA se quedan en el proceso del IDE. La receta sólo acepta `check`, `test` o `typecheck`. `typecheck` (npm) se corta a los 60 s; `check` y `test` (cargo) se cortan a los 120 s. El veto y la propagación escriben sólo cuando el bilátice no queda en `⊤∧⊥`. `load_local_weights` no recibe una ruta: el archivo lo elige el diálogo del sistema y el hijo sólo lee la cabecera GGUF. Ninguno de los de lectura recibe la carpeta: leen la raíz activa. El WebView no abre la red de los proveedores: `ai_exchange` la abre el proceso, con la clave del llavero, y sólo hacia `api.anthropic.com`, `api.openai.com`, `api.deepseek.com`, o HTTP en `localhost` / `127.0.0.1`. No hay comando que lea una clave en claro.

`inspect_media_dialog` no recibe una ruta del WebView. Mide el archivo elegido en el diálogo y rechaza más de 33_554_432 bytes sin leer los píxeles. `transmute_workspace` recorre sólo la carpeta activa. Cerrar una carpeta suelta su malla cognitiva y la sesión del oráculo de esa ruta.

Cada carpeta del estante es su propia jaula. `workspace_activate` y `workspace_close_root` reciben el identificador que emitió el backend, no una ruta libre. El diálogo de «Abrir carpeta» sigue eligiendo la ruta en el sistema operativo. El ledger y los embeddings de una carpeta no se leen desde otra.

Eso es confianza explícita hacia la interfaz local para invocar comandos. Un WebView hostil no puede convertir otra carpeta en la jaula: no hay parámetro de raíz en el árbol ni en la lectura o escritura. Al pasar de ocho carpetas, la menos usada sale y se llama al mismo `forget` que el cierre manual. El diálogo nativo sigue eligiendo la ruta nueva. El proceso no es un sandbox del sistema operativo.

## Qué no es un shell

La consola inferior sólo llama a `oracle_converse`. Ese comando habla con el oráculo del proceso hijo. No hay PTY ni intérprete del host en el handler.

`read_source_file` lee cualquier ruta y vive en la CLI de `bara-ide`. No está registrado como comando IPC.

`github_clone` ejecuta `git` con la lista fija `clone --progress -- <url> <destino>`. La URL se reescribe a `github.com` después de rechazar otros hosts, credenciales y `..`. El destino es la carpeta que devolvió el diálogo, más un único componente con el nombre del repositorio. No es un shell: no hay `cmd /c` ni `sh -c`.

## Contrato del puente

`bridge_snapshot` y el cockpit entregan JSON en *snake_case*, el texto que firmó el kernel. El frontend lo parsea antes de pintar. Los paneles de análisis, AETHER-Ω y el lienzo siguen en `camelCase` vía `serde`. Mezclar los dos contratos vacía la ventana.

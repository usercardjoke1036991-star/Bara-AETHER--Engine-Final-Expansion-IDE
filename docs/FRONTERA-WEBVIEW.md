# Frontera de confianza del WebView

El shell de escritorio (`bara-ide-desktop`, Tauri v2) no es un sandbox del sistema operativo. Es una jaula de rutas delante de un motor que no lee el disco.

## Qué confina `ActiveWorkspace`

La raíz activa es una ruta canónica. La instalan `workspace_open_dialog` y `github_clone`. `workspace_tree`, `workspace_read_document` y `workspace_write_document` no aceptan una raíz: leen y escriben sólo dentro de la que ya está activa.

`analyze_file` y `read_document` no eligen otra raíz: abren sólo un `.bara` que, ya canonizado, queda dentro de esa raíz.

Antes de tocar el disco se rechaza `..` y cualquier componente que no sea un nombre normal. Después se canoniza (enlaces incluidos) y el resultado tiene que cumplir `starts_with` sobre la raíz. El guardado del editor escribe `.bara`. `judge_auto_patch` puede escribir una fuente del proyecto, con el mismo tope de 2 MiB, sólo cuando el núcleo devuelve `∅`. El árbol no sigue enlaces simbólicos, recanoniza cada carpeta, salta `target/`, `node_modules/` y `.git/`, y corta a profundidad 24.

## Qué confía en el WebView

Las ventanas `main`, `topology`, `autopoiesis`, `telemetry` y `ai-workspace` comparten la capacidad `core:default`. La CSP de producción permite `self`, el canal IPC local y sólo `https://api.anthropic.com` y `https://api.openai.com`. Pueden invocar todos los comandos registrados en `generate_handler!`. Hoy son 56: los 37 de análisis, oráculo, paneles, lienzo, puente y cockpit, más `workspace_open_dialog`, `github_clone`, `workspace_roots`, `workspace_activate`, `workspace_close_root`, `open_desk_window`, `transmute_workspace`, `inspect_media_dialog`, `get_local_completions`, `get_workspace_topology_graph`, `workspace_source_text`, `run_workspace_recipe`, `judge_auto_patch`, `load_local_weights`, `local_complete`, `transmute_global`, `idle_proposal`, `idle_apply` e `idle_dismiss`. La receta sólo acepta `check`, `test` o `typecheck` y se corta a los 30 s. El veto y la propagación escriben sólo cuando el bilátice no queda en `⊤∧⊥`. `load_local_weights` no recibe una ruta: el archivo lo elige el diálogo del sistema y sólo se lee la cabecera GGUF. Ninguno de los de lectura recibe la carpeta: leen la raíz activa y no abren la red.

`inspect_media_dialog` no recibe una ruta del WebView. Mide el archivo elegido en el diálogo y rechaza más de 33_554_432 bytes sin leer los píxeles. `transmute_workspace` recorre sólo la carpeta activa. Cerrar una carpeta suelta su malla cognitiva y la sesión del oráculo de esa ruta.

Cada carpeta del estante es su propia jaula. `workspace_activate` y `workspace_close_root` reciben el identificador que emitió el backend, no una ruta libre. El diálogo de «Abrir carpeta» sigue eligiendo la ruta en el sistema operativo. El ledger y los embeddings de una carpeta no se leen desde otra.

Eso es confianza explícita hacia la interfaz local para invocar comandos. Un WebView hostil no puede convertir otra carpeta en la jaula: no hay parámetro de raíz en el árbol ni en la lectura o escritura. Al pasar de ocho carpetas, la menos usada sale y se llama al mismo `forget` que el cierre manual. El diálogo nativo sigue eligiendo la ruta nueva. El proceso no es un sandbox del sistema operativo.

## Qué no es un shell

La consola inferior sólo llama a `oracle_converse`. Ese comando habla con `bara::repl::Oracle`. No hay PTY ni intérprete del host en el handler.

`read_source_file` lee cualquier ruta y vive en la CLI de `bara-ide`. No está registrado como comando IPC.

`github_clone` ejecuta `git` con la lista fija `clone --progress -- <url> <destino>`. La URL se reescribe a `github.com` después de rechazar otros hosts, credenciales y `..`. El destino es la carpeta que devolvió el diálogo, más un único componente con el nombre del repositorio. No es un shell: no hay `cmd /c` ni `sh -c`.

## Contrato del puente

`bridge_snapshot` y el cockpit entregan JSON en *snake_case*, el texto que firmó el kernel. El frontend lo parsea antes de pintar. Los paneles de análisis, AETHER-Ω y el lienzo siguen en `camelCase` vía `serde`. Mezclar los dos contratos vacía la ventana.

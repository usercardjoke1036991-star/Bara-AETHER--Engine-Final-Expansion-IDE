#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════════════════
#  Bara IDE Desktop — runner de cargo para toolchains GNU (MinGW)
#
#  `cargo run` (y por tanto `npm run tauri dev`) lanza el binario a través de
#  este runner, declarado en `src-tauri/.cargo/config.toml`:
#
#      [target.x86_64-pc-windows-gnu]
#      runner = ["python", "...\\scripts\\win-gnu-runner.py"]
#
#  El manifiesto (Common-Controls 6.0) y el icono tienen que estar *dentro* del
#  `.exe` antes de que el cargador lo abra, y `build.rs` no puede hacerlo
#  porque corre antes del enlace. Aquí el `.exe` ya está enlazado: se parchea
#  (idempotente) y se lanza con `CreateProcess`, el mismo camino que usan
#  `cargo` y `tauri`.
#
#  Los binarios que no son la aplicación (pruebas, ejemplos, `cargo bench`…)
#  se ejecutan sin tocar nada.
# ══════════════════════════════════════════════════════════════════════════

from __future__ import annotations

import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RECURSOS = os.path.join(AQUI, "win-gnu-recursos.py")
NOMBRE_APP = "bara-ide-desktop.exe"


def necesita_recursos(binario):
    """¿El binario enlaza Tauri y necesita manifiesto/icono embebidos?

    No sólo la aplicación: los binarios de prueba de `bara-ide-desktop`
    (`bara_ide_desktop_lib-<hash>.exe`, `bara_ide_desktop-<hash>.exe`) también
    enlazan WebView2/muda y mueren con 0xC0000139 si el manifiesto no está
    dentro del `.exe`. El runner los parchea igual que la app.
    """
    nombre = os.path.basename(binario).lower()
    return (
        nombre == NOMBRE_APP
        or nombre.startswith("bara_ide_desktop")
        or nombre.startswith("bara-ide-desktop")
    )


def main(argv):
    if len(argv) < 2:
        print("uso: win-gnu-runner.py RUTA_BINARIO [ARGUMENTOS...]", file=sys.stderr)
        return 2

    binario, argumentos = argv[1], argv[2:]
    if necesita_recursos(binario):
        try:
            subprocess.run([sys.executable, RECURSOS, "--exe", binario], check=False)
        except OSError as error:
            print("aviso: no pude parchear el .exe (%s)" % error, file=sys.stderr)

    return subprocess.call([binario] + argumentos)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

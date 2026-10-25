#!/usr/bin/env python3
"""Enlazador de CI para Linux.

`src-tauri/build.rs` añade `-Wl,--exclude-all-symbols` cuando
`CARGO_CFG_TARGET_ENV=gnu`. Eso cubre MinGW y también Linux. Rust 1.99
enlaza con rust-lld, que rechaza ese flag de PE.

Los argumentos no se reenvían a `cc` en `argv`: se contrastan con una
lista blanca, se descarta solo ese flag y el resto se escribe en un
archivo de respuesta. `cc` recibe únicamente esa ruta fija.
"""

import os
import re
import sys

DROP = {"-Wl,--exclude-all-symbols", "--exclude-all-symbols"}
# Flags y rutas de rustc. Sin blanco, comillas ni «@»: un «@» haría que
# cc abriera otro archivo de respuesta.
SAFE = re.compile(r"^[A-Za-z0-9_./+=:,\-]+$")


def accepted(arg: str) -> str | None:
    if arg in DROP:
        return None
    if SAFE.fullmatch(arg) is None:
        sys.stderr.write(f"linux-link: argumento rechazado: {arg!r}\n")
        raise SystemExit(1)
    return arg


def main() -> None:
    chosen: list[str] = []
    for raw in sys.argv[1:]:
        arg = accepted(raw)
        if arg is not None:
            chosen.append(arg)
    path = f"/tmp/bara-linux-link-{os.getpid()}.args"
    with open(path, "w", encoding="ascii", newline="\n") as handle:
        handle.write("\n".join(chosen))
        if chosen:
            handle.write("\n")
    os.execvp("cc", ["cc", "@" + path])


if __name__ == "__main__":
    main()

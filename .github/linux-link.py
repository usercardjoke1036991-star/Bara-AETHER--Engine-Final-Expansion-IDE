#!/usr/bin/env python3
"""Enlazador de CI para Linux.

`src-tauri/build.rs` añade `-Wl,--exclude-all-symbols` cuando
`CARGO_CFG_TARGET_ENV=gnu`. Eso cubre MinGW (el ordinal de PE se desborda)
y también `x86_64-unknown-linux-gnu`. Rust 1.99 enlaza con rust-lld, que
rechaza ese flag de PE. Aquí se retira solo ese argumento y se delega en cc.
"""

import os
import sys

DROP = {"-Wl,--exclude-all-symbols", "--exclude-all-symbols"}


def main() -> None:
    args = [arg for arg in sys.argv[1:] if arg not in DROP]
    os.execvp("cc", ["cc", *args])


if __name__ == "__main__":
    main()

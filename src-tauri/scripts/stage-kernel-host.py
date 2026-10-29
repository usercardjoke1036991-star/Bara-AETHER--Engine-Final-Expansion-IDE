#!/usr/bin/env python3
"""Copia `bara-kernel-host` al nombre con triple que pide Tauri `externalBin`.

El binario de empaquetado no activa `--features faults`: esas operaciones
sólo existen para las pruebas del proceso hijo.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def triple() -> str:
    text = subprocess.check_output(["rustc", "-vV"], text=True, encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit("rustc -vV no informa el host")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=("debug", "release"), default="release")
    args = parser.parse_args()
    manifest = ROOT / "kernel-host" / "Cargo.toml"
    meta = json.loads(
        subprocess.check_output(
            [
                "cargo",
                "metadata",
                "--format-version",
                "1",
                "--no-deps",
                "--manifest-path",
                str(manifest),
            ],
            text=True,
            encoding="utf-8",
        )
    )
    folder = "release" if args.profile == "release" else "debug"
    built_name = "bara-kernel-host.exe" if sys.platform == "win32" else "bara-kernel-host"
    built = Path(meta["target_directory"]) / folder / built_name
    command = [
        "cargo",
        "build",
        "--manifest-path",
        str(manifest),
        "--bin",
        "bara-kernel-host",
        "--locked",
    ]
    if args.profile == "release":
        command.append("--release")
    subprocess.check_call(command)
    if not built.is_file():
        raise SystemExit(f"no apareció {built}")
    suffix = ".exe" if sys.platform == "win32" else ""
    dest_dir = ROOT / "src-tauri" / "binaries"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"bara-kernel-host-{triple()}{suffix}"
    shutil.copy2(built, dest)
    print(dest)


if __name__ == "__main__":
    main()

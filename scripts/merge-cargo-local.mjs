#!/usr/bin/env node
// Inyecta o quita el [patch] de Cargo.toml.local en Cargo.toml (marcadores).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cargoPath = join(root, "Cargo.toml");
const localPath = join(root, "Cargo.toml.local");
const BEGIN = "# BEGIN-CARGO-TOML-LOCAL";
const END = "# END-CARGO-TOML-LOCAL";

let cargo = readFileSync(cargoPath, "utf8");
const re = new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "m");
cargo = cargo.replace(re, "");

if (existsSync(localPath)) {
  const local = readFileSync(localPath, "utf8").trim();
  const block = `${BEGIN}\n${local}\n${END}\n`;
  if (!cargo.endsWith("\n")) {
    cargo += "\n";
  }
  cargo += `\n${block}`;
  writeFileSync(cargoPath, cargo);
  console.log("Cargo.toml: patch local aplicado desde Cargo.toml.local");
} else {
  writeFileSync(cargoPath, cargo);
  console.log("Cargo.toml: sin Cargo.toml.local (queda el pin git)");
}

import { useState, type FormEvent } from "react";

import type { BelnapLattice, ObservationView } from "../engine";
import type { RecipeName } from "../recipes";
import BelnapMeter from "./BelnapMeter";

/** Una línea ya respondida por el oráculo del kernel. */
export interface ConsoleLine {
  input: string;
  reply: string;
  roots: string;
}

interface KernelConsoleProps {
  lines: ConsoleLine[];
  busy: boolean;
  lattice: BelnapLattice | null;
  current: ObservationView | null;
  /** Envía la línea al oráculo del proceso hijo (`oracle_converse`), no a un shell. */
  onSubmit: (line: string) => void;
  /** Lanza una receta del catálogo cerrado. */
  onRecipe: (recipe: RecipeName) => void;
}

/**
 * Consola inferior del kernel.
 *
 * No abre una PTY ni un intérprete del sistema: cada línea entra al oráculo
 * del proceso hijo (`bara::repl::Oracle`). Así un turno no puede salir
 * de la jaula de rutas ni lanzar un proceso arbitrario.
 */
export default function KernelConsole({
  lines,
  busy,
  lattice,
  current,
  onSubmit,
  onRecipe,
}: KernelConsoleProps) {
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const line = draft.trim();
    if (line.length === 0 || busy) {
      return;
    }
    onSubmit(line);
    setDraft("");
  }

  return (
    <section className="kernel-console" aria-label="Consola del kernel">
      <BelnapMeter lattice={lattice} current={current} />
      <div className="row recipe-row">
        <button type="button" disabled={busy} onClick={() => onRecipe("check")}>
          comprobar
        </button>
        <button type="button" disabled={busy} onClick={() => onRecipe("test")}>
          probar conflicto
        </button>
        <button type="button" disabled={busy} onClick={() => onRecipe("typecheck")}>
          tipos
        </button>
        <span className="muted">Alt+1 · Alt+2 · Alt+3</span>
      </div>
      <div className="console-log" aria-live="polite">
        {lines.length === 0 ? (
          <p className="muted">
            Consola del oráculo. Escribe una raíz, lengua natural o un meta-comando
            (`:estado`, `:deshacer`). No es una terminal del sistema.
          </p>
        ) : (
          lines.map((line, index) => (
            <p key={`${index}:${line.input}`}>
              <span className="console-prompt">ברא› </span>
              {line.input}
              <br />
              <span className="console-reply">{line.reply}</span>
              {line.roots.length > 0 ? (
                <span className="console-roots"> · {line.roots}</span>
              ) : null}
            </p>
          ))
        )}
      </div>
      <form className="console-form" onSubmit={submit}>
        <span className="console-prompt" aria-hidden="true">
          ברא›
        </span>
        <input
          className="console-input"
          value={draft}
          spellCheck={false}
          disabled={busy}
          placeholder="ברא, crea un mundo, :estado"
          aria-label="Línea para el oráculo del kernel"
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
    </section>
  );
}

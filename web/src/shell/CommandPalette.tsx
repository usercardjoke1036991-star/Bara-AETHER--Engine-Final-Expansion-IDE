// Paleta de comandos (Ctrl+Shift+P): overlay, Esc y clic fuera cierran.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { filterCommands, type CommandAction } from "./commands";

interface CommandPaletteProps {
  open: boolean;
  commands: CommandAction[];
  onClose: () => void;
}

export default function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setQuery("");
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  function run(index: number) {
    const cmd = filtered[index];
    if (!cmd) {
      return;
    }
    onClose();
    cmd.run();
  }

  return createPortal(
    <div
      className="cmd-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(filtered.length - 1, i + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            run(active);
          }
        }}
      >
        <div className="cmd-palette-head">
          <input
            ref={inputRef}
            className="cmd-palette-input"
            value={query}
            placeholder="Buscar acción…"
            aria-label="Buscar comando"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="cmd-palette-close" title="Cerrar (Esc)" onClick={onClose}>
            ×
          </button>
        </div>
        <ul className="cmd-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="muted cmd-palette-empty">Sin coincidencias</li>
          ) : (
            filtered.map((cmd, index) => (
              <li key={cmd.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  className={`cmd-palette-item${index === active ? " active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(index)}
                >
                  {cmd.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

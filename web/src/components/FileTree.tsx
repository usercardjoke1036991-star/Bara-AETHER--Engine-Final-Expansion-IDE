// Árbol recursivo del workspace.
//
// El nodo no decide qué archivos se pueden abrir: el backend ya marcó con
// `bara` los documentos editables y el padre (`WorkspaceSidebar`) entrega la
// entrada completa al editor. Esta pieza sólo pliega/despliega y pinta.

import { useState } from "react";

import { pathKey, pathsEqual } from "../paths";
import type { WorkspaceEntry } from "../workspace";

interface FileTreeProps {
  /** Entradas del nivel actual. */
  entries: WorkspaceEntry[];
  /** Ruta activa en el editor (para resaltarla). */
  activePath: string | null;
  /** Se invoca al pulsar un archivo `.bara`. */
  onOpen: (entry: WorkspaceEntry) => void;
  /** Nivel de anidamiento (0 = raíz). */
  depth?: number;
}

/** Pinta una lista de nodos del workspace. */
export default function FileTree({
  entries,
  activePath,
  onOpen,
  depth = 0,
}: FileTreeProps) {
  if (entries.length === 0) {
    return <p className="tree-empty">Sin documentos en este nivel.</p>;
  }

  return (
    <ul className="file-tree" role="tree" aria-label="Archivos del workspace">
      {entries.map((entry) => (
        <FileTreeNode
          key={pathKey(entry.path)}
          entry={entry}
          activePath={activePath}
          onOpen={onOpen}
          depth={depth}
        />
      ))}
    </ul>
  );
}

interface FileTreeNodeProps {
  entry: WorkspaceEntry;
  activePath: string | null;
  onOpen: (entry: WorkspaceEntry) => void;
  depth: number;
}

/** Un nodo: carpeta plegable o archivo (sólo `.bara` es accionable). */
function FileTreeNode({ entry, activePath, onOpen, depth }: FileTreeNodeProps) {
  // Las carpetas de primer nivel arrancan abiertas; las profundas, plegadas.
  const [open, setOpen] = useState(depth === 0);

  if (entry.kind === "dir") {
    return (
      <li role="treeitem" aria-expanded={open}>
        <button
          type="button"
          className="tree-row tree-dir"
          onClick={() => setOpen((current) => !current)}
          title={entry.path}
        >
          <span className="tree-glyph" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="tree-name">{entry.name}</span>
          <span className="tree-count">{entry.children.length}</span>
        </button>
        {open ? (
          <FileTree
            entries={entry.children}
            activePath={activePath}
            onOpen={onOpen}
            depth={depth + 1}
          />
        ) : null}
      </li>
    );
  }

  const active = pathsEqual(activePath, entry.path);
  return (
    <li role="treeitem" aria-selected={active}>
      <button
        type="button"
        className={`tree-row tree-file${active ? " active" : ""}`}
        disabled={!entry.bara}
        onClick={() => onOpen(entry)}
        title={
          entry.bara
            ? entry.path
            : `${entry.path} (sólo los documentos .bara se editan)`
        }
      >
        <span className="tree-glyph" aria-hidden="true">
          {entry.bara ? "◈" : "·"}
        </span>
        <span className="tree-name">{entry.name}</span>
      </button>
    </li>
  );
}

// Árbol recursivo del workspace.
//
// El padre entrega la entrada al editor. Aquí se pliega/despliega y se habilitan
// las extensiones editables del lote (A4), no sólo `.bara`.

import { useState } from "react";

import { isEditorPath } from "../editorFiles";
import { pathKey, pathsEqual } from "../paths";
import {
  ICON_FILE,
  ICON_FILE_BARA,
  ICON_FOLDER,
  ICON_FOLDER_OPEN,
  WorkspaceIcon,
} from "../shell/WorkspaceIcons";
import type { WorkspaceEntry } from "../workspace";

interface FileTreeProps {
  /** Entradas del nivel actual. */
  entries: WorkspaceEntry[];
  /** Ruta activa en el editor (para resaltarla). */
  activePath: string | null;
  /** Se invoca al pulsar un archivo editable. */
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

/** Un nodo: carpeta plegable o archivo editable del lote. */
function FileTreeNode({ entry, activePath, onOpen, depth }: FileTreeNodeProps) {
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
          <WorkspaceIcon
            src={open ? ICON_FOLDER_OPEN : ICON_FOLDER}
            label={open ? "Carpeta abierta" : "Carpeta"}
          />
          <span className="tree-name">{entry.name}</span>
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

  const editable = entry.bara || isEditorPath(entry.path);
  const active = pathsEqual(activePath, entry.path);
  return (
    <li role="treeitem" aria-selected={active}>
      <button
        type="button"
        className={`tree-row tree-file${active ? " active" : ""}`}
        disabled={!editable}
        onClick={() => onOpen(entry)}
        title={
          editable
            ? entry.path
            : `${entry.path} (extensión no editable en el IDE)`
        }
      >
        <WorkspaceIcon
          src={entry.bara ? ICON_FILE_BARA : ICON_FILE}
          label={entry.bara ? "Documento .bara" : "Archivo"}
        />
        <span className="tree-name">{entry.name}</span>
      </button>
    </li>
  );
}

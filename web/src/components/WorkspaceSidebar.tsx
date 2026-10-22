// Barra lateral del workspace: raíz, recarga y árbol recursivo.
//
// La raíz es un texto editable porque el escritorio no incorpora un selector
// nativo de carpetas (el backend no añade plugins): el usuario puede pegar
// cualquier ruta absoluta y el comando `workspace_tree` la canonicaliza antes
// de enumerarla.

import { useEffect, useState, type FormEvent } from "react";

import FileTree from "./FileTree";
import type { WorkspaceEntry, WorkspaceTree } from "../workspace";

interface WorkspaceSidebarProps {
  /** Raíz canónica actual. */
  root: string;
  /** Última enumeración válida (o `null` mientras arranca). */
  tree: WorkspaceTree | null;
  /** Hay una petición de árbol en curso. */
  loading: boolean;
  /** Ruta activa en el editor. */
  activePath: string | null;
  /** Abre una carpeta escribiendo su ruta. */
  onOpenRoot: (root: string) => void;
  /** Vuelve a enumerar la raíz actual. */
  onRefresh: () => void;
  /** Abre un documento `.bara`. */
  onOpenFile: (entry: WorkspaceEntry) => void;
}

/** Panel lateral con el explorador recursivo del workspace. */
export default function WorkspaceSidebar({
  root,
  tree,
  loading,
  activePath,
  onOpenRoot,
  onRefresh,
  onOpenFile,
}: WorkspaceSidebarProps) {
  const [draft, setDraft] = useState(root);

  // Si el backend devuelve la raíz canónica (por ejemplo, `.` → absoluta),
  // el campo refleja siempre lo que realmente se está explorando.
  useEffect(() => {
    setDraft(root);
  }, [root]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (next.length > 0 && next !== root) {
      onOpenRoot(next);
    }
  }

  return (
    <aside className="workspace" aria-label="Explorador del workspace">
      <div className="workspace-head">
        <h2>Workspace</h2>
        <button
          type="button"
          className="icon-button"
          disabled={loading || root.length === 0}
          onClick={onRefresh}
          title="Volver a enumerar la raíz"
          aria-label="Recargar el árbol del workspace"
        >
          ↻
        </button>
      </div>

      <form className="workspace-root" onSubmit={submit}>
        <input
          className="path"
          value={draft}
          spellCheck={false}
          placeholder="C:\\ruta\\al\\workspace"
          aria-label="Ruta de la raíz del workspace"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={loading || draft.trim() === root}>
          Abrir
        </button>
      </form>

      {tree ? (
        <p className="workspace-meta" title={tree.root}>
          {tree.name} · {tree.files} .bara
          {tree.truncated ? " · vista recortada" : ""}
        </p>
      ) : (
        <p className="workspace-meta">Sin explorador cargado.</p>
      )}

      <div className="workspace-tree">
        {loading ? (
          <p className="muted">Enumerando…</p>
        ) : tree ? (
          <FileTree
            entries={tree.entries}
            activePath={activePath}
            onOpen={onOpenFile}
          />
        ) : (
          <p className="muted">Escribe una raíz y pulsa «Abrir».</p>
        )}
      </div>

      <p className="workspace-note">
        Se excluyen <code>target/</code>, <code>node_modules/</code> y{" "}
        <code>.git/</code>. Sólo se editan documentos <code>.bara</code>.
      </p>
    </aside>
  );
}

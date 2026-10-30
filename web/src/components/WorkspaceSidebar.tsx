// Barra lateral del workspace: raíz activa, recarga y árbol recursivo.
//
// La carpeta entra por el diálogo del sistema o por un clon de GitHub.
// El campo de ruta es de sólo lectura: el WebView no impone otra raíz.

import { useEffect, useState } from "react";

import { describeError } from "../engine";
import FileTree from "./FileTree";
import {
  workspaceActivate,
  workspaceCloseRoot,
  workspaceRoots,
  type WorkspaceEntry,
  type WorkspaceShelf,
  type WorkspaceTree,
} from "../workspace";

interface WorkspaceSidebarProps {
  /** Raíz canónica actual. */
  root: string;
  /** Última enumeración válida (o `null` mientras arranca). */
  tree: WorkspaceTree | null;
  /** Hay una petición de árbol en curso. */
  loading: boolean;
  /** Ruta activa en el editor. */
  activePath: string | null;
  /** Diálogo nativo: la carpeta elegida sustituye a la raíz activa. */
  onPickFolder: () => void;
  /** Muestra la puerta de clonación de GitHub. */
  onClone: () => void;
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
  onPickFolder,
  onClone,
  onRefresh,
  onOpenFile,
}: WorkspaceSidebarProps) {
  const [shelf, setShelf] = useState<WorkspaceShelf | null>(null);
  const [shelfError, setShelfError] = useState<string | null>(null);

  useEffect(() => {
    void workspaceRoots()
      .then((next) => {
        setShelf(next);
        setShelfError(null);
      })
      .catch((reason: unknown) => {
        setShelfError(describeError(reason));
      });
  }, [root]);

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

      <div className="workspace-actions">
        <button type="button" disabled={loading} onClick={onPickFolder}>
          Abrir carpeta
        </button>
        <button type="button" disabled={loading} onClick={onClone}>
          Clonar
        </button>
      </div>

      {shelf && shelf.roots.length > 0 ? (
        <ul className="shelf">
          {shelf.roots.map((slot) => {
            const onlyRoot = shelf.roots.length <= 1;
            return (
            <li key={slot.id}>
              <button
                type="button"
                className={slot.active ? "shelf-active" : undefined}
                disabled={loading}
                onClick={() => {
                  // `workspace-root-changed` reinicia editor/diff en todas las ventanas.
                  void workspaceActivate(slot.id)
                    .then(() => onRefresh())
                    .catch((reason: unknown) => {
                      setShelfError(describeError(reason));
                    });
                }}
              >
                {slot.name}
              </button>
              <button
                type="button"
                className="shelf-close"
                aria-label={onlyRoot ? `No se cierra la última carpeta (${slot.name})` : `Cerrar ${slot.name}`}
                title={onlyRoot ? "La última carpeta del estante no se cierra" : "Cerrar carpeta"}
                disabled={loading || onlyRoot}
                onClick={() => {
                  if (onlyRoot) {
                    return;
                  }
                  void workspaceCloseRoot(slot.id)
                    .then((next) => {
                      setShelf(next);
                      setShelfError(null);
                      onRefresh();
                    })
                    .catch((reason: unknown) => {
                      setShelfError(describeError(reason));
                    });
                }}
              >
                ×
              </button>
            </li>
            );
          })}
        </ul>
      ) : null}
      {shelfError ? <p className="error">{shelfError}</p> : null}

      <p className="workspace-root path" title={root}>
        {root || "Sin carpeta activa"}
      </p>

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
          <p className="muted">Abre una carpeta con el diálogo del sistema.</p>
        )}
      </div>

      <p className="workspace-note">
        Se excluyen <code>target/</code>, <code>node_modules/</code> y{" "}
        <code>.git/</code>. Sólo se editan documentos <code>.bara</code>.
      </p>
    </aside>
  );
}

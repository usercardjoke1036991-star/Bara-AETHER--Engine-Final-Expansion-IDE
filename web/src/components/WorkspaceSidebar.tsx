// Barra lateral: PROYECTOS (recientes) arriba · ARCHIVOS (árbol del activo) abajo.

import { useCallback, useEffect, useMemo, useState } from "react";

import { describeError } from "../engine";
import {
  forgetRecent,
  loadRecents,
  mergeShelfDisplay,
  rememberShelf,
  type RecentProject,
} from "../projectRecents";
import { ICON_FOLDER, WorkspaceIcon } from "../shell/WorkspaceIcons";
import FileTree from "./FileTree";
import {
  workspaceActivate,
  workspaceCloseRoot,
  workspaceReopen,
  workspaceRoots,
  type WorkspaceEntry,
  type WorkspaceShelf,
  type WorkspaceTree,
} from "../workspace";

interface WorkspaceSidebarProps {
  root: string;
  tree: WorkspaceTree | null;
  loading: boolean;
  activePath: string | null;
  onPickFolder: () => void;
  onClone: () => void;
  onRefresh: () => void;
  onOpenFile: (entry: WorkspaceEntry) => void;
  /** A5: crear / renombrar / borrar dentro de la jaula. */
  onCreateFile?: () => void;
  onCreateDir?: () => void;
  onRenameActive?: () => void;
  onDeleteActive?: () => void;
}

/** Panel lateral: multi-proyecto + árbol del activo. */
export default function WorkspaceSidebar({
  root,
  tree,
  loading,
  activePath,
  onPickFolder,
  onClone,
  onRefresh,
  onOpenFile,
  onCreateFile,
  onCreateDir,
  onRenameActive,
  onDeleteActive,
}: WorkspaceSidebarProps) {
  const [shelf, setShelf] = useState<WorkspaceShelf | null>(null);
  const [recents, setRecents] = useState<RecentProject[]>(() => loadRecents().roots);
  const [shelfError, setShelfError] = useState<string | null>(null);

  const syncShelf = useCallback((next: WorkspaceShelf) => {
    setShelf(next);
    setRecents(rememberShelf(next));
    setShelfError(null);
  }, []);

  useEffect(() => {
    void workspaceRoots()
      .then((next) => {
        syncShelf(next);
      })
      .catch((reason: unknown) => {
        setShelfError(describeError(reason));
      });
  }, [root, syncShelf]);

  const displayRoots = useMemo(() => mergeShelfDisplay(shelf, recents), [shelf, recents]);

  const activate = useCallback(
    (slot: { id: string; path: string; active: boolean }) => {
      if (slot.active) {
        return;
      }
      const inShelf = shelf?.roots.some((item) => item.id === slot.id);
      const run = inShelf
        ? workspaceActivate(slot.id)
        : workspaceReopen(slot.path);
      void run
        .then((next) => {
          syncShelf(next);
          onRefresh();
        })
        .catch((reason: unknown) => {
          setShelfError(describeError(reason));
        });
    },
    [onRefresh, shelf, syncShelf],
  );

  const remove = useCallback(
    (slot: { id: string }, onlyRoot: boolean) => {
      if (onlyRoot) {
        return;
      }
      const inShelf = shelf?.roots.some((item) => item.id === slot.id);
      if (inShelf) {
        void workspaceCloseRoot(slot.id)
          .then((next) => {
            syncShelf(next);
            setRecents(forgetRecent(slot.id));
            rememberShelf(next);
            onRefresh();
          })
          .catch((reason: unknown) => {
            setShelfError(describeError(reason));
          });
        return;
      }
      setRecents(forgetRecent(slot.id));
    },
    [onRefresh, shelf, syncShelf],
  );

  return (
    <aside className="workspace" aria-label="Explorador del workspace">
      <section className="ws-section ws-projects" aria-label="Proyectos">
        <details open>
        <summary className="ws-section-head">
          <h2>PROYECTOS</h2>
          <button
            type="button"
            className="icon-button"
            disabled={loading || root.length === 0}
            onClick={(event) => {
              event.preventDefault();
              onRefresh();
            }}
            title="Volver a enumerar la raíz activa"
            aria-label="Recargar el árbol del workspace"
          >
            ↻
          </button>
        </summary>

        <div className="workspace-actions">
          <button type="button" disabled={loading} onClick={onPickFolder}>
            Abrir carpeta
          </button>
          <button type="button" disabled={loading} onClick={onClone}>
            Clonar
          </button>
        </div>

        {displayRoots.length > 0 ? (
          <ul className="shelf">
            {displayRoots.map((slot) => {
              const liveCount = shelf?.roots.length ?? 0;
              const onlyRoot = liveCount <= 1 && !!shelf?.roots.some((item) => item.id === slot.id);
              return (
                <li key={slot.id} className={slot.active ? "shelf-item-active" : undefined}>
                  <button
                    type="button"
                    className={slot.active ? "shelf-active" : undefined}
                    disabled={loading}
                    title={slot.path}
                    onClick={() => activate(slot)}
                  >
                    <span className="shelf-main">
                      <WorkspaceIcon src={ICON_FOLDER} label="Proyecto" />
                      <span className="shelf-name">{slot.name}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="shelf-close"
                    aria-label={
                      onlyRoot
                        ? `No se quita el último proyecto (${slot.name})`
                        : `Quitar ${slot.name} de la lista`
                    }
                    title={
                      onlyRoot
                        ? "El último proyecto del estante no se quita"
                        : "Quitar de la lista (no borra el disco)"
                    }
                    disabled={loading || onlyRoot}
                    onClick={() => remove(slot, onlyRoot)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted ws-empty">Sin proyectos. Abre o clona una carpeta.</p>
        )}
        {shelfError ? <p className="error">{shelfError}</p> : null}
        </details>
      </section>

      <section className="ws-section ws-files" aria-label="Archivos del proyecto activo">
        <div className="ws-section-head">
          <h2 title={root || undefined}>ARCHIVOS</h2>
        </div>

        <div className="workspace-actions ws-file-ops">
          <button
            type="button"
            disabled={loading || root.length === 0 || !onCreateFile}
            onClick={() => onCreateFile?.()}
            title="Crear archivo en la jaula"
          >
            Nuevo
          </button>
          <button
            type="button"
            disabled={loading || root.length === 0 || !onCreateDir}
            onClick={() => onCreateDir?.()}
            title="Crear carpeta en la jaula"
          >
            Carpeta
          </button>
          <button
            type="button"
            disabled={loading || !activePath || !onRenameActive}
            onClick={() => onRenameActive?.()}
            title="Renombrar o mover la entrada activa"
          >
            Renombrar
          </button>
          <button
            type="button"
            disabled={loading || !activePath || !onDeleteActive}
            onClick={() => onDeleteActive?.()}
            title="Borrar (pide confirmación; papelera .bara-trash)"
          >
            Borrar
          </button>
        </div>

        {tree?.truncated ? (
          <p className="workspace-meta">Vista recortada</p>
        ) : null}

        <div className="workspace-tree">
          {loading ? (
            <p className="muted">Enumerando…</p>
          ) : tree ? (
            <FileTree entries={tree.entries} activePath={activePath} onOpen={onOpenFile} />
          ) : (
            <p className="muted">Abre una carpeta con el diálogo del sistema.</p>
          )}
        </div>

        <p className="workspace-note">
          Se excluyen <code>target/</code>, <code>node_modules/</code>,{" "}
          <code>.git/</code>, <code>.bara-backup/</code> y <code>.bara-trash/</code>.
          Textos y otros lenguajes del lote se editan con diff y respaldo.
        </p>
      </section>
    </aside>
  );
}

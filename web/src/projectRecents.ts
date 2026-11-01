// Recientes de PROYECTOS (localStorage). Sin secretos ni API keys.

import type { WorkspaceRootView, WorkspaceShelf } from "./workspace";

const KEY = "bara.projects.v1";
const MAX = 8;

export interface RecentProject {
  id: string;
  path: string;
  name: string;
}

interface Store {
  activeId: string;
  roots: RecentProject[];
}

/** Path corto para la lista (cola legible). */
export function shortPath(path: string, max = 42): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `…${normalized.slice(-(max - 1))}`;
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return { activeId: "", roots: [] };
    }
    const parsed = JSON.parse(raw) as Partial<Store>;
    const roots = Array.isArray(parsed.roots)
      ? parsed.roots
          .filter(
            (item): item is RecentProject =>
              !!item &&
              typeof item.id === "string" &&
              typeof item.path === "string" &&
              typeof item.name === "string",
          )
          .slice(0, MAX)
      : [];
    return {
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : "",
      roots,
    };
  } catch {
    return { activeId: "", roots: [] };
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        activeId: store.activeId,
        roots: store.roots.slice(0, MAX).map(({ id, path, name }) => ({ id, path, name })),
      }),
    );
  } catch {
    // almacén cerrado / cuota
  }
}

/** Sincroniza el estante del backend con los recientes locales. */
export function rememberShelf(shelf: WorkspaceShelf): RecentProject[] {
  const prev = readStore();
  const byId = new Map(prev.roots.map((item) => [item.id, item]));
  for (const root of shelf.roots) {
    byId.set(root.id, { id: root.id, path: root.path, name: root.name });
  }
  // Orden: activos del shelf primero, luego el resto de recientes.
  const ordered: RecentProject[] = [];
  const seen = new Set<string>();
  for (const root of shelf.roots) {
    const item = byId.get(root.id);
    if (item) {
      ordered.push(item);
      seen.add(item.id);
    }
  }
  for (const item of prev.roots) {
    if (!seen.has(item.id)) {
      ordered.push(item);
      seen.add(item.id);
    }
  }
  const next: Store = {
    activeId: shelf.activeId || prev.activeId,
    roots: ordered.slice(0, MAX),
  };
  writeStore(next);
  return next.roots;
}

/** Quita un proyecto de los recientes (no toca el disco). */
export function forgetRecent(id: string): RecentProject[] {
  const prev = readStore();
  const roots = prev.roots.filter((item) => item.id !== id);
  writeStore({
    activeId: prev.activeId === id ? (roots[0]?.id ?? "") : prev.activeId,
    roots,
  });
  return roots;
}

/** Recientes guardados (pueden incluir carpetas aún no readmitidas en el estante). */
export function loadRecents(): Store {
  return readStore();
}

/** Une estante vivo + recientes para mostrar ≥ N proyectos en la UI. */
export function mergeShelfDisplay(
  shelf: WorkspaceShelf | null,
  recents: RecentProject[],
): WorkspaceRootView[] {
  const live = shelf?.roots ?? [];
  const byId = new Map(live.map((item) => [item.id, item]));
  const out: WorkspaceRootView[] = live.map((item) => ({ ...item }));
  for (const recent of recents) {
    if (byId.has(recent.id)) {
      continue;
    }
    out.push({
      id: recent.id,
      path: recent.path,
      name: recent.name,
      active: false,
    });
  }
  return out;
}

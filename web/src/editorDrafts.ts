// Borradores locales por proyecto+ruta (recuperación tras cierre abrupto).
// Preferencia de autoguardado a disco (on/off).

import { projectKey } from "./ai/projectKey";

const DRAFTS_KEY = "bara.editor.drafts.v1";
const AUTOSAVE_KEY = "bara.editor.autosave.v1";

export interface EditorDraft {
  projectId: string;
  path: string;
  source: string;
  /** Huella del último guardado en disco cuando se creó el borrador. */
  savedHash: string;
  updatedAt: number;
}

type DraftBucket = Record<string, EditorDraft>;

function draftId(projectId: string, path: string): string {
  return `${projectId}::${path.replace(/\\/g, "/")}`;
}

function readBucket(): DraftBucket {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as DraftBucket;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBucket(bucket: DraftBucket): void {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(bucket));
  } catch {
    // cuota
  }
}

export function loadAutosaveEnabled(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAutosaveEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

export function saveDraft(
  workspaceRoot: string,
  path: string,
  source: string,
  savedHash: string,
): void {
  const projectId = projectKey(workspaceRoot);
  if (!projectId || !path.trim()) {
    return;
  }
  const bucket = readBucket();
  const id = draftId(projectId, path);
  bucket[id] = {
    projectId,
    path: path.replace(/\\/g, "/"),
    source,
    savedHash,
    updatedAt: Date.now(),
  };
  writeBucket(bucket);
}

export function clearDraft(workspaceRoot: string, path: string): void {
  const projectId = projectKey(workspaceRoot);
  if (!projectId) {
    return;
  }
  const bucket = readBucket();
  delete bucket[draftId(projectId, path)];
  writeBucket(bucket);
}

export function listDraftsForProject(workspaceRoot: string): EditorDraft[] {
  const projectId = projectKey(workspaceRoot);
  if (!projectId) {
    return [];
  }
  return Object.values(readBucket())
    .filter((draft) => draft.projectId === projectId && draft.source.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function takeDraft(workspaceRoot: string, path: string): EditorDraft | null {
  const projectId = projectKey(workspaceRoot);
  if (!projectId) {
    return null;
  }
  const bucket = readBucket();
  const id = draftId(projectId, path);
  const draft = bucket[id] ?? null;
  if (draft) {
    delete bucket[id];
    writeBucket(bucket);
  }
  return draft;
}

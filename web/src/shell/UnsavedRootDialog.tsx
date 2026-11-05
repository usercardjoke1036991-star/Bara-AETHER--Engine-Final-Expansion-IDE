export interface UnsavedTab {
  path: string;
  name: string;
  source: string;
  saved: string;
}

/** Pestañas cuyo texto vivo no coincide con lo último guardado. */
export function unsavedTabs<T extends UnsavedTab>(tabs: readonly T[]): T[] {
  return tabs.filter((tab) => tab.source !== tab.saved);
}

interface UnsavedRootDialogProps {
  names: readonly string[];
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/** Guardar / Descartar / Cancelar antes de cambiar de carpeta. */
export default function UnsavedRootDialog({
  names,
  busy,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedRootDialogProps) {
  return (
    <div
      className="trust-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-root-title"
    >
      <div className="trust-dialog-card">
        <h2 id="unsaved-root-title">Cambios sin guardar</h2>
        <p className="muted">
          Hay pestañas con cambios. Elige antes de cambiar de carpeta.
        </p>
        <ul>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <div className="row trust-actions">
          <button type="button" disabled={busy} onClick={onSave}>
            Guardar
          </button>
          <button type="button" disabled={busy} onClick={onDiscard}>
            Descartar
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

interface DraftConflictDialogProps {
  path: string;
  diff: string;
  busy: boolean;
  onOverwrite: () => void;
  onCancel: () => void;
}

/** Disco contra borrador. Guardar pisa el disco; cancelar deja ambos como están. */
export default function DraftConflictDialog({
  path,
  diff,
  busy,
  onOverwrite,
  onCancel,
}: DraftConflictDialogProps) {
  return (
    <div className="trust-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-conflict-title">
      <div className="trust-dialog-card">
        <h2 id="draft-conflict-title">El archivo cambió en disco</h2>
        <p className="muted">
          «{path}» no coincide con la huella del borrador. Revisa el diff antes de guardar.
        </p>
        <pre className="draft-conflict-diff">{diff}</pre>
        <div className="row trust-actions">
          <button type="button" disabled={busy} onClick={onOverwrite}>
            Guardar el borrador
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

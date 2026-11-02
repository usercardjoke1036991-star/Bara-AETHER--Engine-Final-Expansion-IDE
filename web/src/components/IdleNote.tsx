// Nota de reposo compartida (App + Cockpit). Misma UI en ambos call-sites.

export default function IdleNote({
  message,
  onApply,
  onDismiss,
}: {
  message: string;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="idle-note" role="status">
      <span>{message}</span>
      <button type="button" onClick={onApply}>
        transmutar
      </button>
      <button type="button" onClick={onDismiss}>
        ahora no
      </button>
    </div>
  );
}

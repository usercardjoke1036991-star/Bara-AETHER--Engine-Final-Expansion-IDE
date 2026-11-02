// Barra de estado inferior: ítems clicables.

interface StatusBarProps {
  fileLabel: string;
  kernel: string;
  /** Etiqueta de badge (verificado / equilibrado / …). */
  badgeLabel: string;
  badgeTone: "ok" | "warn" | "neutral";
  tokenCount: number | null;
  onFile: () => void;
  onKernel: () => void;
  onVerified: () => void;
  onTokens: () => void;
}

export default function StatusBar({
  fileLabel,
  kernel,
  badgeLabel,
  badgeTone,
  tokenCount,
  onFile,
  onKernel,
  onVerified,
  onTokens,
}: StatusBarProps) {
  return (
    <footer className="status-bar" role="contentinfo">
      <button type="button" className="status-item" title="Archivo activo" onClick={onFile}>
        {fileLabel}
      </button>
      <button type="button" className="status-item" title="Estado del kernel" onClick={onKernel}>
        kernel {kernel}
      </button>
      <button
        type="button"
        className={`status-item${badgeTone === "ok" ? " ok" : badgeTone === "warn" ? " warn" : ""}`}
        title="Resultado de verificación / equilibrio"
        onClick={onVerified}
      >
        {badgeLabel}
      </button>
      <button type="button" className="status-item" title="Tokens del análisis" onClick={onTokens}>
        {tokenCount === null ? "tokens —" : `${tokenCount} tokens`}
      </button>
    </footer>
  );
}

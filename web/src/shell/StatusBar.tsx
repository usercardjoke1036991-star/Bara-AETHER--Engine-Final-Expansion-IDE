// Barra de estado inferior: ítems clicables.

interface StatusBarProps {
  fileLabel: string;
  kernel: string;
  verified: boolean | null;
  tokenCount: number | null;
  onFile: () => void;
  onKernel: () => void;
  onVerified: () => void;
  onTokens: () => void;
}

export default function StatusBar({
  fileLabel,
  kernel,
  verified,
  tokenCount,
  onFile,
  onKernel,
  onVerified,
  onTokens,
}: StatusBarProps) {
  const verifiedLabel =
    verified === null ? "sin análisis" : verified ? "verificado" : "no verificado";
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
        className={`status-item${verified === true ? " ok" : verified === false ? " warn" : ""}`}
        title="Resultado de verificación"
        onClick={onVerified}
      >
        {verifiedLabel}
      </button>
      <button type="button" className="status-item" title="Tokens del análisis" onClick={onTokens}>
        {tokenCount === null ? "tokens —" : `${tokenCount} tokens`}
      </button>
    </footer>
  );
}

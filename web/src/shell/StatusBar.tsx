// Barra de estado inferior: ítems clicables.

import AppVersion from "./AppVersion";

interface StatusBarProps {
  fileLabel: string;
  kernel: string;
  /** Etiqueta de badge (verificado / equilibrado / …). */
  badgeLabel: string;
  badgeTone: "ok" | "warn" | "neutral";
  tokenCount: number | null;
  problemCount: number;
  onFile: () => void;
  onKernel: () => void;
  onVerified: () => void;
  onTokens: () => void;
  onProblems: () => void;
}

export default function StatusBar({
  fileLabel,
  kernel,
  badgeLabel,
  badgeTone,
  tokenCount,
  problemCount,
  onFile,
  onKernel,
  onVerified,
  onTokens,
  onProblems,
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
      <button
        type="button"
        className={`status-item${problemCount > 0 ? " warn" : ""}`}
        title="Problemas del documento"
        onClick={onProblems}
      >
        {problemCount === 0 ? "0 problemas" : `${problemCount} problemas`}
      </button>
      <button type="button" className="status-item" title="Tokens del análisis" onClick={onTokens}>
        {tokenCount === null ? "tokens —" : `${tokenCount} tokens`}
      </button>
      <span className="status-version">
        <AppVersion />
      </span>
    </footer>
  );
}

import { useEffect } from "react";

import { escStopsAtField } from "./uxRules";

interface ErrorBannerProps {
  message: string;
  onClose: () => void;
}

/** Aviso de error con × y Esc. Esc en el editor no lo cierra. */
export default function ErrorBanner({ message, onClose }: ErrorBannerProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || escStopsAtField(event)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="error error-banner" role="alert">
      <span>{message}</span>
      <button type="button" aria-label="Cerrar aviso" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

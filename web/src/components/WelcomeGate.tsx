import { useEffect, useRef, useState, type FormEvent } from "react";

interface WelcomeGateProps {
  /** Hay una apertura o un clon en curso. */
  busy: boolean;
  /** Última línea de progreso de `git clone`, si la hay. */
  progress: string | null;
  /** Diálogo nativo de carpeta y esa carpeta pasa a ser el workspace. */
  onOpenFolder: () => void;
  /** Valida la URL, pide la carpeta destino y clona sin shell. */
  onClone: (url: string) => void;
  /** Sigue con la carpeta de arranque, sin importar nada. */
  onDismiss: () => void;
}

/** Puerta de entrada: abrir una carpeta local o clonar un repo de GitHub. */
export default function WelcomeGate({
  busy,
  progress,
  onOpenFolder,
  onClone,
  onDismiss,
}: WelcomeGateProps) {
  const [url, setUrl] = useState("");
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    openRef.current?.focus();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = url.trim();
    if (next.length === 0 || busy) {
      return;
    }
    onClone(next);
  }

  return (
    <section className="welcome" role="dialog" aria-modal="false" aria-label="Abrir un workspace">
      <p className="welcome-kicker">Bara IDE</p>
      <h2>Empieza por una carpeta</h2>
      <p className="muted">
        Abre un proyecto de este equipo o clónalo desde GitHub. Luego edita los
        archivos <code>.bara</code> en el centro; el chat queda a la derecha.
      </p>

      <div className="welcome-actions">
        <button type="button" ref={openRef} disabled={busy} onClick={onOpenFolder}>
          Abrir carpeta
        </button>
      </div>

      <form className="welcome-clone" onSubmit={submit}>
        <label>
          <span>Repositorio de GitHub (HTTPS o SSH)</span>
          <input
            className="path"
            value={url}
            spellCheck={false}
            disabled={busy}
            placeholder="https://github.com/dueño/repositorio"
            aria-label="URL del repositorio de GitHub"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || url.trim().length === 0}>
          Elegir carpeta y clonar
        </button>
      </form>

      {progress ? <p className="welcome-progress">{progress}</p> : null}

      <button type="button" className="welcome-dismiss" disabled={busy} onClick={onDismiss}>
        Continuar con la carpeta de arranque
      </button>
    </section>
  );
}

// Panel del **Cockpit de telemetría** del kernel congelado.
//
// Carga las tres proyecciones de sólo lectura (`get_system_manifest`,
// `get_neural_frame`, `get_flight_recorder_logs`) y ejecuta la única operación
// mutante (`transmute_input`). Todo el juicio —censo, auditoría, indexación y
// sellado— ocurre en Rust; el panel sólo pinta y refresca.

import { useCallback, useEffect, useState } from "react";

import { kernelAutopoiesis, type AutopoiesisReport } from "../aether";
import { idleApply, idleDismiss, idleProposal, type IdleNotice } from "../idle";
import { describeError } from "../engine";
import {
  flightRecorderLogs,
  neuralFrame,
  systemManifest,
  transmuteInput,
  type FlightLog,
  type NeuralFrame,
  type SystemManifest,
  type TransmutationResult,
} from "../telemetry";
import { AttentionCard, CensoCard, RecorderCard, ShoreshCard, TransmuterCard } from "./CockpitCards";

export default function CockpitPanel({
  open,
  source,
}: {
  /** Visibilidad del panel (lo gobierna el encabezado del IDE). */
  open: boolean;
  /** Documento actual del editor, disponible para el transmutador. */
  source: string;
}) {
  /** Manifiesto canónico y demo servidos por el puente. */
  const [manifest, setManifest] = useState<SystemManifest | null>(null);
  /** Último marco cognitivo de la ventana. */
  const [frame, setFrame] = useState<NeuralFrame | null>(null);
  /** Volcado de la caja negra. */
  const [logs, setLogs] = useState<FlightLog | null>(null);
  /** Fuente en edición dentro de la consola del transmutador. */
  const [entry, setEntry] = useState("");
  const [idle, setIdle] = useState<IdleNotice | null>(null);
  /** Dictamen de la última transmutación. */
  const [outcome, setOutcome] = useState<TransmutationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  /** Autopoiesis del documento abierto: pesos de los axiomas mutados. */
  const [axioms, setAxioms] = useState<AutopoiesisReport | null>(null);

  /** Relee las tres proyecciones y siembra el editor si está vacío. */
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [nextManifest, nextFrame, nextLogs] = await Promise.all([
        systemManifest(),
        neuralFrame(),
        flightRecorderLogs(),
      ]);
      setManifest(nextManifest);
      setFrame(nextFrame);
      setLogs(nextLogs);
      // El demo lo dicta el kernel: TypeScript no duplica ni un literal.
      setEntry((previous) => (previous.trim().length === 0 ? nextManifest.demo : previous));
      setError(null);
      setReady(true);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  // Arranque perezoso: no se invoca nada hasta que el panel se abre. El panel
  // sigue montado cuando se oculta, así que una carga en vuelo puede publicar
  // su resultado sin riesgo de actualizar un componente desmontado.
  useEffect(() => {
    if (open && !ready) {
      void load();
    }
  }, [open, ready, load]);

  // El documento cambia más a menudo que el marco. Se espera un instante y se
  // pide la autopoiesis del texto abierto, sin retener el temporizador al salir.
  useEffect(() => {
    if (!open) {
      return;
    }
    const text = source.trim();
    if (text.length === 0) {
      setAxioms(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void kernelAutopoiesis(text)
        .then((report) => {
          if (alive) {
            setAxioms(report);
          }
        })
        .catch(() => {
          if (alive) {
            setAxioms(null);
          }
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, source]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let alive = true;
    const tick = () => {
      void idleProposal()
        .then((notice) => {
          if (alive) {
            setIdle(notice);
          }
        })
        .catch(() => {
          if (alive) {
            setIdle(null);
          }
        });
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open]);

  /** Transmuta la fuente y refresca el marco y la caja negra. */
  const run = useCallback(async () => {
    setBusy(true);
    try {
      const result = await transmuteInput(entry);
      setOutcome(result);
      const [nextFrame, nextLogs] = await Promise.all([neuralFrame(), flightRecorderLogs()]);
      setFrame(nextFrame);
      setLogs(nextLogs);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [entry]);

  /** Editar la fuente invalida el dictamen anterior (evita leerlo fuera de contexto). */
  const edit = useCallback((value: string) => {
    setEntry(value);
    setOutcome(null);
  }, []);

  if (!open) {
    return null;
  }

  const status = busy ? "sincronizando…" : ready ? "proyecciones al día" : "sin conexión";

  return (
    <section className="pane cockpit" aria-label="cockpit de telemetría">
      <div className="row ck-head">
        <h2>Cockpit de telemetría</h2>
        <span className={`ck-status ${busy ? "" : ready ? "kx-ok" : "kx-warn"}`}>{status}</span>
        <span className="grow" />
        <button type="button" disabled={busy} onClick={() => void load()}>
          actualizar
        </button>
      </div>

      {error ? <p className="ai-error">{error}</p> : null}
      {idle ? (
        <div className="idle-note" role="status">
          <span>{idle.message}</span>
          <button
            type="button"
            onClick={() => {
              void idleApply().finally(() => setIdle(null));
            }}
          >
            transmutar
          </button>
          <button
            type="button"
            onClick={() => {
              void idleDismiss().finally(() => setIdle(null));
            }}
          >
            ahora no
          </button>
        </div>
      ) : null}

      {manifest && frame && logs ? (
        <div className="ck-grid">
          <CensoCard frame={frame} />
          <AttentionCard frame={frame} axioms={axioms} />
          <TransmuterCard
            entry={entry}
            outcome={outcome}
            busy={busy}
            onEntry={edit}
            onRun={() => void run()}
            onDocument={() => edit(source)}
            onDemo={() => edit(manifest.demo)}
          />
          <ShoreshCard frame={frame} manifest={manifest} />
          <RecorderCard logs={logs} />
        </div>
      ) : (
        <p className="muted">
          {busy ? "Consultando al kernel…" : "Sin proyecciones del kernel."}
        </p>
      )}
    </section>
  );
}

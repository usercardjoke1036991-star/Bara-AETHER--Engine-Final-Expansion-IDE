// Panel AETHER-Ω: las cinco fases del kernel proyectadas sobre el documento.
//
// Todo lo que se pinta aquí lo decidió el núcleo (`aether` del backend): la
// autopoiesis y la puerta ZK (fase 1), el banco cuántico, la malla holográfica,
// el Metal-IR y el control temporal `Δ⁻¹` (fase 2), la geometría áurea de la
// memoria (fase 3) y el puente de sólo lectura `bara::ide_bridge` (fase 5). La
// interfaz sólo pide, acota los parámetros y formatea: no reimplementa física,
// lógica ni reparto.

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_PLAN_WIDTHS,
  fractalMemory,
  fractalPlan,
  kernelAutopoiesis,
  meshSync,
  metalIr,
  quantumNative,
  temporalTimeline,
  type AutopoiesisReport,
  type FractalMemoryView,
  type MeshView,
  type MetalView,
  type QuantumView,
  type TimelineView,
} from "../aether";
import {
  bridgeManifest,
  bridgeSnapshot,
  type BridgeManifest,
  type BridgeSnapshot,
} from "../bridge";
import { describeError } from "../engine";
import {
  AutopoiesisCard,
  BridgeCard,
  FractalCard,
  MeshCard,
  MetalCard,
  QuantumCard,
  TimelineCard,
} from "./KernelCards";

/**
 * Anchos del plan áureo a partir del texto del panel.
 *
 * Total: se aceptan comas, puntos y comas y espacios; los valores no numéricos
 * se cuentan (`invalid`) y se ignoran, y una lista vacía es el reparto vacío del
 * núcleo (no un error).
 */
function parseWidths(text: string): { widths: number[]; invalid: number } {
  const widths: number[] = [];
  let invalid = 0;
  for (const token of text.split(/[\s,;]+/)) {
    if (token.length === 0) {
      continue;
    }
    const value = Number(token);
    if (Number.isInteger(value) && value >= 0 && value <= 1 << 20) {
      widths.push(value);
    } else {
      invalid += 1;
    }
  }
  return { widths, invalid };
}

export interface KernelPanelProps {
  /** Visibilidad del panel (lo gobierna `App`). */
  open: boolean;
  /** Texto del documento abierto: lo que el kernel proyecta. */
  source: string;
}

/** Las siete proyecciones que el panel pide al núcleo por cada documento. */
interface Projections {
  autopoiesis: AutopoiesisReport;
  quantum: QuantumView;
  mesh: MeshView;
  metal: MetalView;
  timeline: TimelineView;
  fractal: FractalMemoryView;
  bridge: BridgeSnapshot;
}

export default function KernelPanel({ open, source }: KernelPanelProps) {
  const [projections, setProjections] = useState<Projections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Contrato del puente (`bridge_manifest`): se carga una vez al abrir. */
  const [contract, setContract] = useState<BridgeManifest | null>(null);
  /** Parámetros del panel de malla (el núcleo los vuelve a acotar). */
  const [peers, setPeers] = useState(3);
  const [rounds, setRounds] = useState(2);
  const [threaded, setThreaded] = useState(false);
  /** Dispositivo destino del Metal-IR (`cpu` o `gpu`). */
  const [device, setDevice] = useState("cpu");
  /** Anchos del reparto áureo *puro* (fase 3, sin runtime). */
  const [planText, setPlanText] = useState(DEFAULT_PLAN_WIDTHS.join(", "));
  const [plan, setPlan] = useState<FractalMemoryView | null>(null);

  /** Pide las siete proyecciones del núcleo y las publica. */
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [autopoiesis, quantum, mesh, metal, timeline, fractal, bridge] = await Promise.all([
        kernelAutopoiesis(source),
        quantumNative(source),
        meshSync(source, peers, rounds, threaded),
        metalIr(source, device),
        temporalTimeline(source),
        fractalMemory(source),
        bridgeSnapshot(source),
      ]);
      setProjections({ autopoiesis, quantum, mesh, metal, timeline, fractal, bridge });
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }, [source, peers, rounds, threaded, device]);

  // El contrato del puente no depende del documento: se pide una sola vez.
  useEffect(() => {
    if (!open || contract !== null) {
      return undefined;
    }
    let alive = true;
    void (async () => {
      try {
        const manifest = await bridgeManifest();
        if (alive) {
          setContract(manifest);
        }
      } catch (failure) {
        if (alive) {
          setError(describeError(failure));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, contract]);

  // Proyección en vivo con retardo: no se invoca al kernel en cada tecla.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void load();
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, load]);

  /** Reparto áureo puro de los anchos escritos en el panel. */
  const runPlan = useCallback(async () => {
    const { widths } = parseWidths(planText);
    try {
      setPlan(await fractalPlan(widths));
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    }
  }, [planText]);

  useEffect(() => {
    if (open && plan === null) {
      void runPlan();
    }
  }, [open, plan, runPlan]);

  if (!open) {
    return null;
  }

  return (
    <section className="pane kernel">
      <div className="row">
        <h2>AETHER-Ω · proyecciones del kernel</h2>
        <span className="grow" />
        <span className="status">
          {busy ? "proyectando…" : `${source.length} caracteres`}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void load();
          }}
        >
          Reprojectar
        </button>
      </div>

      {error ? <p className="ai-error">{error}</p> : null}

      {projections ? (
        <>
          <AutopoiesisCard report={projections.autopoiesis} />
          <QuantumCard view={projections.quantum} />
          <MeshCard
            view={projections.mesh}
            peers={peers}
            rounds={rounds}
            threaded={threaded}
            onPeers={setPeers}
            onRounds={setRounds}
            onThreaded={setThreaded}
          />
          <MetalCard view={projections.metal} device={device} onDevice={setDevice} />
          <TimelineCard view={projections.timeline} />
          <FractalCard
            memory={projections.fractal}
            plan={plan}
            planText={planText}
            onPlanText={setPlanText}
            onPlan={() => {
              void runPlan();
            }}
          />
          <BridgeCard document={projections.bridge} contract={contract} />
        </>
      ) : (
        <p className="muted">Sin proyecciones todavía: el núcleo aún no respondió.</p>
      )}
    </section>
  );
}


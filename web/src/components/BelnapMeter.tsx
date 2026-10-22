import type { BelnapLattice, ObservationView } from "../engine";

interface BelnapMeterProps {
  /** Los cuatro puntos canónicos, servidos por el kernel. */
  lattice: BelnapLattice | null;
  /** Observación que ahora mismo está en la cima del runtime. */
  current: ObservationView | null;
}

const ORDER = ["true", "false", "both", "neither"] as const;

/** Los cuatro valores de Belnap, con el que ocupa la cima marcado en vivo. */
export default function BelnapMeter({ lattice, current }: BelnapMeterProps) {
  const points = lattice?.values ?? [];
  return (
    <div className="belnap-meter" role="group" aria-label="Valores de Belnap">
      {ORDER.map((key) => {
        const point = points.find((candidate) => candidate.key === key);
        const glyph = point?.observation.glyph ?? key;
        const name = point?.observation.name ?? key;
        const live = current !== null && point !== undefined && current.glyph === point.observation.glyph;
        return (
          <div className={`belnap-cell${live ? " live" : ""}`} key={key}>
            <span className="belnap-glyph">{glyph}</span>
            <span className="belnap-name">{name}</span>
            <span className="belnap-mass">
              {point ? `⊤ ${point.truth} · ⊥ ${point.falsity}` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

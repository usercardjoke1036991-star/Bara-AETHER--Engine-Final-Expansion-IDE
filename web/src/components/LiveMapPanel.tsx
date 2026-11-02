// §9.4 — vista del mapa vivo en el panel inferior (overflow propio).

import { useCallback, useEffect, useState } from "react";

import { describeError } from "../engine";
import {
  liveMapSnapshot,
  type DesyncWarning,
  type FileDep,
  type LiveMapSnapshot,
} from "../liveMap";

interface LiveMapPanelProps {
  workspaceRoot: string;
  focusPath?: string;
}

export default function LiveMapPanel({ workspaceRoot, focusPath = "" }: LiveMapPanelProps) {
  const [map, setMap] = useState<LiveMapSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    if (!workspaceRoot) {
      setMap(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setMap(await liveMapSnapshot());
    } catch (reason: unknown) {
      setError(describeError(reason));
      setMap(null);
    } finally {
      setBusy(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (focusPath) {
      setFilter(focusPath);
    }
  }, [focusPath]);

  if (!workspaceRoot) {
    return <p className="muted">Abre una carpeta para ver el mapa vivo.</p>;
  }

  const needle = filter.trim().toLowerCase();
  const deps: FileDep[] = (map?.deps ?? []).filter(
    (d) =>
      !needle ||
      d.from.toLowerCase().includes(needle) ||
      d.to.toLowerCase().includes(needle),
  );
  const warnings: DesyncWarning[] = (map?.warnings ?? []).filter(
    (w) => !needle || w.path.toLowerCase().includes(needle) || w.detail.toLowerCase().includes(needle),
  );

  return (
    <div className="live-map-panel zone-scroll">
      <div className="row live-map-toolbar">
        <input
          className="path"
          value={filter}
          spellCheck={false}
          placeholder="filtrar ruta…"
          onChange={(event) => setFilter(event.target.value)}
        />
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          {busy ? "…" : "Actualizar"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {map ? (
        <p className="muted">
          {map.files.length} archivo(s) · {map.deps.length} arista(s)
          {map.truncated ? " · truncado" : ""} · topología {map.topologyNodes}/{map.topologyEdges}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <section aria-label="Avisos de desincronía">
          <h4>Avisos</h4>
          <ul className="live-map-warnings">
            {warnings.slice(0, 40).map((w, i) => (
              <li key={`${w.kind}:${w.path}:${i}`}>
                <span className="live-map-kind">{w.kind}</span>{" "}
                <code>{w.path}</code> — {w.detail}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="muted">Sin avisos de desincronía en el filtro.</p>
      )}
      <section aria-label="Dependencias archivo a archivo">
        <h4>Dependencias</h4>
        {deps.length === 0 ? (
          <p className="muted">Sin aristas para el filtro.</p>
        ) : (
          <ul className="live-map-deps">
            {deps.slice(0, 120).map((d, i) => (
              <li key={`${d.from}->${d.to}:${d.kind}:${i}`}>
                <code>{d.from}</code>
                <span className="muted"> → </span>
                <code>{d.to}</code>
                <span className="live-map-kind"> {d.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

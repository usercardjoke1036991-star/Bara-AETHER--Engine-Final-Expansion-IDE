import { useEffect, useMemo, useRef, useState } from "react";

import { describeError } from "../engine";
import { transmuteGlobal } from "../offline";
import {
  publishTopologyReveal,
  publishVeto,
  readVeto,
  VETO_CHANNEL,
  workspaceTopologyGraph,
  type GraphEdge,
  type GraphNode,
  type WorkspaceTopology,
} from "../topology";

const KIND_LABEL: Record<string, string> = {
  file: "archivo",
  function: "función",
  type: "tipo",
  contract: "contrato",
};

const KIND_COLOR: Record<string, string> = {
  file: "#7f8ea3",
  function: "#4fd1c5",
  type: "#9ecbff",
  contract: "#f0b429",
};

const BOTH = "⊤∧⊥";

interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

function hash(text: string): number {
  let acc = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    acc ^= text.charCodeAt(index);
    acc = Math.imul(acc, 16777619);
  }
  return acc >>> 0;
}

function seedBody(id: string, index: number, total: number): Body {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 + (hash(id) % 16) * 0.01;
  const ring = 80 + (hash(id) % 140);
  return {
    id,
    x: Math.cos(angle) * ring,
    y: Math.sin(angle) * ring,
    vx: 0,
    vy: 0,
  };
}

/** Vista de grafo de la carpeta activa. El trazado es un canvas local. */
export default function TopologyGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bodies = useRef(new Map<string, Body>());
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const alpha = useRef(1);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const pan = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const moved = useRef(false);
  const pointerOrigin = useRef({ x: 0, y: 0 });
  const visibleRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const hoverRef = useRef<string | null>(null);
  const vetoRef = useRef<Set<string>>(new Set());
  const [graph, setGraph] = useState<WorkspaceTopology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [languages, setLanguages] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>(["file", "function", "type", "contract"]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [fromName, setFromName] = useState("");
  const [toName, setToName] = useState("");
  const [propagateNote, setPropagateNote] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    setError(null);
    workspaceTopologyGraph()
      .then((next) => {
        setGraph(next);
        const present = [...new Set(next.nodes.map((node) => node.language))].sort((left, right) =>
          left.localeCompare(right),
        );
        setLanguages(present);
        alpha.current = 1;
      })
      .catch((reason: unknown) => setError(describeError(reason)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel(VETO_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const veto = readVeto(event.data);
      if (veto === null) {
        return;
      }
      vetoRef.current.add(veto.path);
      vetoRef.current.add(`${veto.path}:${veto.line}`);
    };
    return () => channel.close();
  }, []);

  const languageSet = useMemo(() => new Set(languages), [languages]);
  const kindSet = useMemo(() => new Set(kinds), [kinds]);
  const visible = useMemo(() => {
    if (graph === null) {
      return [];
    }
    return graph.nodes.filter(
      (node) => languageSet.has(node.language) && kindSet.has(node.kind),
    );
  }, [graph, languageSet, kindSet]);

  const visibleEdges = useMemo(() => {
    if (graph === null) {
      return [];
    }
    const ids = new Set(visible.map((node) => node.id));
    return graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  }, [graph, visible]);

  visibleRef.current = visible;
  edgesRef.current = visibleEdges;

  useEffect(() => {
    const total = visible.length;
    visible.forEach((node, index) => {
      if (!bodies.current.has(node.id)) {
        bodies.current.set(node.id, seedBody(node.id, index, total));
      }
    });
  }, [visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (canvas === null || stage === null) {
      return undefined;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return undefined;
    }
    let frame = 0;
    let alive = true;

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    const worldOf = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = canvas.width / Math.max(rect.width, 1);
      const sx = (clientX - rect.left) * ratio;
      const sy = (clientY - rect.top) * ratio;
      return {
        x: (sx - canvas.width / 2) / camera.current.zoom + camera.current.x,
        y: (sy - canvas.height / 2) / camera.current.zoom + camera.current.y,
      };
    };

    const hit = (clientX: number, clientY: number): GraphNode | null => {
      const world = worldOf(clientX, clientY);
      let found: GraphNode | null = null;
      let best = 18 / camera.current.zoom;
      for (const node of visibleRef.current) {
        const body = bodies.current.get(node.id);
        if (body === undefined) {
          continue;
        }
        const distance = Math.hypot(body.x - world.x, body.y - world.y);
        if (distance < best) {
          best = distance;
          found = node;
        }
      }
      return found;
    };

    const tick = () => {
      const nodes = visibleRef.current;
      const edges = edgesRef.current;
      const live = nodes
        .map((node) => bodies.current.get(node.id))
        .filter((body): body is Body => body !== undefined);
      if (alpha.current > 0.02 && drag.current === null && live.length > 1) {
        const count = live.length;
        for (const body of live) {
          body.vx += (0 - body.x) * 0.008;
          body.vy += (0 - body.y) * 0.008;
        }
        for (let left = 0; left < count; left += 1) {
          const a = live[left];
          if (a === undefined) {
            continue;
          }
          for (let right = left + 1; right < count; right += 1) {
            const b = live[right];
            if (b === undefined) {
              continue;
            }
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let dist = Math.hypot(dx, dy);
            if (dist < 0.1) {
              dist = 0.1;
              dx = 0.1;
            }
            const force = 1400 / (dist * dist);
            const ux = (dx / dist) * force;
            const uy = (dy / dist) * force;
            a.vx += ux;
            a.vy += uy;
            b.vx -= ux;
            b.vy -= uy;
          }
        }
        for (const edge of edges) {
          const a = bodies.current.get(edge.source);
          const b = bodies.current.get(edge.target);
          if (a === undefined || b === undefined) {
            continue;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.1;
          const rest = 42 + Math.min(edge.weight, 24) * 3;
          const pull = (dist - rest) * 0.012;
          const ux = (dx / dist) * pull;
          const uy = (dy / dist) * pull;
          a.vx += ux;
          a.vy += uy;
          b.vx -= ux;
          b.vy -= uy;
        }
        for (const body of live) {
          body.vx *= 0.72;
          body.vy *= 0.72;
          const speed = Math.hypot(body.vx, body.vy);
          if (speed > 14) {
            body.vx = (body.vx / speed) * 14;
            body.vy = (body.vy / speed) * 14;
          }
          body.x += body.vx * alpha.current;
          body.y += body.vy * alpha.current;
        }
        alpha.current *= 0.992;
      }
    };

    const paint = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = canvas.width / Math.max(rect.width, 1);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.fillStyle = "#0b0f14";
      context.fillRect(0, 0, rect.width, rect.height);
      context.save();
      context.translate(rect.width / 2, rect.height / 2);
      context.scale(camera.current.zoom, camera.current.zoom);
      context.translate(-camera.current.x, -camera.current.y);
      context.lineWidth = 1 / camera.current.zoom;
      context.strokeStyle = "rgba(127, 142, 163, 0.45)";
      for (const edge of edgesRef.current) {
        const a = bodies.current.get(edge.source);
        const b = bodies.current.get(edge.target);
        if (a === undefined || b === undefined) {
          continue;
        }
        context.globalAlpha = 0.35 + (1 - Math.min(edge.weight, 32) / 40) * 0.45;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      context.globalAlpha = 1;
      const pulse = 8 + Math.sin(time / 280) * 6;
      const debt = new Set<string>();
      for (const node of visibleRef.current) {
        if (node.conflictStatus === BOTH) {
          debt.add(node.path);
        }
      }
      for (const node of visibleRef.current) {
        const body = bodies.current.get(node.id);
        if (body === undefined) {
          continue;
        }
        const color = KIND_COLOR[node.kind] ?? "#d7e3f0";
        const radius = node.kind === "file" ? 7 : 5.5;
        const vetoed =
          vetoRef.current.has(`${node.path}:${node.line}`) ||
          (node.kind === "file" && vetoRef.current.has(node.path));
        const own = node.conflictStatus === BOTH || vetoed;
        const latent = node.kind === "file" && debt.has(node.path) && !own;
        const tension =
          own ? 1 : latent ? 0.85 : node.conflictStatus === "⊥" ? 0.45 : node.conflictStatus === "⊤" ? 0.18 : 0.06;
        context.shadowColor = tension >= 0.8 ? "#e07a5f" : tension >= 0.4 ? "#f0b429" : "#4fd1c5";
        context.shadowBlur = tension >= 0.8 ? pulse * tension : tension * 5;
        context.fillStyle = own ? "#e07a5f" : latent ? "#f0b429" : color;
        context.beginPath();
        context.arc(body.x, body.y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        if (hoverRef.current === node.id || visibleRef.current.length <= 180) {
          context.fillStyle = "#d7e3f0";
          context.font = "11px Segoe UI, sans-serif";
          context.fillText(node.label, body.x + 8, body.y + 3);
        }
      }
      context.restore();
    };

    const loop = (time: number) => {
      if (!alive) {
        return;
      }
      if (document.visibilityState !== "hidden") {
        tick();
        paint(time);
      }
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = camera.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08);
      camera.current.zoom = Math.min(4, Math.max(0.25, next));
    };
    const onDown = (event: PointerEvent) => {
      moved.current = false;
      pointerOrigin.current = { x: event.clientX, y: event.clientY };
      const node = hit(event.clientX, event.clientY);
      if (node !== null) {
        const body = bodies.current.get(node.id);
        const world = worldOf(event.clientX, event.clientY);
        if (body !== undefined) {
          drag.current = { id: node.id, dx: body.x - world.x, dy: body.y - world.y };
        }
        hoverRef.current = node.id;
        setSelected(node);
        if (node.kind === "function" || node.kind === "type" || node.kind === "contract") {
          setFromName(node.label);
        }
      } else {
        pan.current = {
          x: event.clientX,
          y: event.clientY,
          cx: camera.current.x,
          cy: camera.current.y,
        };
      }
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (
        Math.hypot(event.clientX - pointerOrigin.current.x, event.clientY - pointerOrigin.current.y) > 4
      ) {
        moved.current = true;
      }
      if (drag.current !== null) {
        const body = bodies.current.get(drag.current.id);
        const world = worldOf(event.clientX, event.clientY);
        if (body !== undefined) {
          body.x = world.x + drag.current.dx;
          body.y = world.y + drag.current.dy;
          body.vx = 0;
          body.vy = 0;
        }
        return;
      }
      if (pan.current !== null) {
        const rect = canvas.getBoundingClientRect();
        const ratio = canvas.width / Math.max(rect.width, 1);
        camera.current.x =
          pan.current.cx - ((event.clientX - pan.current.x) * ratio) / camera.current.zoom;
        camera.current.y =
          pan.current.cy - ((event.clientY - pan.current.y) * ratio) / camera.current.zoom;
        return;
      }
      hoverRef.current = hit(event.clientX, event.clientY)?.id ?? null;
    };
    const onUp = (event: PointerEvent) => {
      const dragged = drag.current !== null;
      drag.current = null;
      pan.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (!dragged) {
        return;
      }
    };
    const onClick = (event: MouseEvent) => {
      if (moved.current) {
        return;
      }
      const node = hit(event.clientX, event.clientY);
      if (node === null || node.path.length === 0) {
        return;
      }
      setSelected(node);
      publishTopologyReveal(node.path, node.line);
      void focusMain();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("click", onClick);
    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("click", onClick);
    };
  }, []);

  const allLanguages =
    graph === null
      ? []
      : [...new Set(graph.nodes.map((node) => node.language))].sort((left, right) =>
          left.localeCompare(right),
        );
  const bothCount = visible.filter((node) => node.conflictStatus === BOTH).length;

  return (
    <div className="topo">
      <aside className="topo-filters">
        <button type="button" onClick={reload} disabled={loading}>
          {loading ? "Leyendo…" : "Actualizar grafo"}
        </button>
        <p className="muted">
          {visible.length} nodos · {visibleEdges.length} aristas
          {bothCount > 0 ? ` · ${bothCount} ⊤∧⊥` : ""}
          {graph?.truncated ? " · recortado" : ""}
        </p>
        <fieldset>
          <legend>Tipo</legend>
          {Object.entries(KIND_LABEL).map(([kind, label]) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={kindSet.has(kind)}
                onChange={() => {
                  setKinds((current) =>
                    current.includes(kind)
                      ? current.filter((item) => item !== kind)
                      : [...current, kind],
                  );
                  alpha.current = 1;
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Lenguaje</legend>
          {allLanguages.map((language) => (
            <label key={language}>
              <input
                type="checkbox"
                checked={languageSet.has(language)}
                onChange={() => {
                  setLanguages((current) =>
                    current.includes(language)
                      ? current.filter((item) => item !== language)
                      : [...current, language],
                  );
                  alpha.current = 1;
                }}
              />
              .{language}
            </label>
          ))}
        </fieldset>
        <form
          className="topo-propagate"
          onSubmit={(event) => {
            event.preventDefault();
            const path = selected?.path ?? "";
            void transmuteGlobal(path, fromName.trim(), toName.trim())
              .then((report) => {
                if (report.status === "both") {
                  for (const file of report.files) {
                    if (file.status === "both") {
                      publishVeto(file.path, 1);
                    }
                  }
                }
                setPropagateNote(
                  report.applied
                    ? `${report.glyph} ${report.files.length} archivo(s) actualizados`
                    : `${report.glyph} propagación detenida`,
                );
                if (report.applied) {
                  reload();
                }
              })
              .catch((reason: unknown) => setError(describeError(reason)));
          }}
        >
          <fieldset>
            <legend>Propagar</legend>
            <input
              value={fromName}
              spellCheck={false}
              placeholder="desde"
              onChange={(event) => setFromName(event.target.value)}
            />
            <input
              value={toName}
              spellCheck={false}
              placeholder="hacia"
              onChange={(event) => setToName(event.target.value)}
            />
            <button type="submit" disabled={fromName.trim().length === 0 || toName.trim().length === 0}>
              aplicar en la red
            </button>
          </fieldset>
          {propagateNote ? <p className="muted">{propagateNote}</p> : null}
        </form>
        {selected ? (
          <p className="topo-card">
            <strong>{selected.label}</strong>
            <br />
            {KIND_LABEL[selected.kind] ?? selected.kind} · {selected.shoreshRoot}
            <br />
            {selected.path}:{selected.line}
            <br />
            {selected.conflictStatus}
          </p>
        ) : (
          <p className="muted">Arrastra el fondo para moverte. La rueda acerca. Un nodo abre el archivo.</p>
        )}
        <p className="muted">⊤ brillo bajo · ⊥ ámbar · ⊤∧⊥ pulso rojo · archivo ámbar si un símbolo interno está en deuda</p>
        {error ? <p className="error">{error}</p> : null}
      </aside>
      <div className="topo-stage" ref={stageRef}>
        <canvas ref={canvasRef} aria-label="Grafo topológico del proyecto" />
      </div>
    </div>
  );
}

async function focusMain(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const main = await WebviewWindow.getByLabel("main");
  await main?.setFocus();
}

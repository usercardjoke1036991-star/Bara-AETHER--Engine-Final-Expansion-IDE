// Barra de actividad: logo AETHER-Ω + icono y nombre completo (mockup).

import type { RefObject } from "react";

import BrandMark from "./BrandMark";
import type { SideMode } from "./layoutState";

export type ActivityId = "files" | "search" | "kernel" | "assist" | "expert" | "settings";

interface ActivityBarProps {
  sideMode: SideMode;
  expertOpen: boolean;
  onToggleSide: (mode: Exclude<SideMode, null>) => void;
  onKernel: () => void;
  onAssist: () => void;
  onExpert: (anchor: HTMLButtonElement) => void;
  expertAnchorRef: RefObject<HTMLButtonElement | null>;
}

const ITEMS: Array<{
  id: ActivityId;
  label: string;
  title: string;
  glyph: string;
}> = [
  { id: "files", label: "Archivos", title: "Explorador de archivos", glyph: "▣" },
  { id: "search", label: "Buscar", title: "Buscar en el árbol", glyph: "⌕" },
  { id: "kernel", label: "Kernel", title: "Panel inferior del kernel", glyph: "⎔" },
  { id: "assist", label: "Asistencia", title: "Adjuntar imagen, vídeo o fragmento", glyph: "◎" },
  { id: "expert", label: "Expertas", title: "Vistas expertas", glyph: "✦" },
  { id: "settings", label: "Ajustes", title: "Ajustes del IDE", glyph: "⚙" },
];

export default function ActivityBar({
  sideMode,
  expertOpen,
  onToggleSide,
  onKernel,
  onAssist,
  onExpert,
  expertAnchorRef,
}: ActivityBarProps) {
  return (
    <nav className="activity-bar" aria-label="Actividad">
      <div className="activity-brand" title="Bara AETHER-Ω">
        <BrandMark size={44} variant="rail" title="AETHER-Ω" />
        <span className="activity-brand-text">
          <span className="activity-brand-he">בָּרָא</span>
          <span className="activity-brand-en">AETHER-Ω</span>
        </span>
      </div>
      {ITEMS.map((item) => {
        const pressed =
          item.id === "files" || item.id === "search" || item.id === "settings"
            ? sideMode === item.id
            : item.id === "expert"
              ? expertOpen
              : false;
        return (
          <button
            key={item.id}
            ref={item.id === "expert" ? expertAnchorRef : undefined}
            type="button"
            className={`activity-btn${pressed ? " active" : ""}`}
            title={item.title}
            aria-label={item.label}
            aria-pressed={pressed}
            onClick={(event) => {
              if (item.id === "files" || item.id === "search" || item.id === "settings") {
                onToggleSide(item.id);
                return;
              }
              if (item.id === "kernel") {
                onKernel();
                return;
              }
              if (item.id === "assist") {
                onAssist();
                return;
              }
              onExpert(event.currentTarget);
            }}
          >
            <span className="activity-glyph" aria-hidden="true">
              {item.glyph}
            </span>
            <span className="activity-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

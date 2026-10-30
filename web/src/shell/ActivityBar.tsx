// Barra de actividad vertical (iconos + tooltip), estilo VS Code.

import type { RefObject } from "react";

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
  { id: "files", label: "Archivos", title: "Explorador de archivos", glyph: "Ar" },
  { id: "search", label: "Buscar", title: "Buscar en el árbol", glyph: "Bu" },
  { id: "kernel", label: "Kernel", title: "Panel inferior del kernel", glyph: "Ke" },
  { id: "assist", label: "Asistencia", title: "Adjuntar imagen, vídeo o fragmento", glyph: "As" },
  { id: "expert", label: "Expertas", title: "Vistas expertas", glyph: "Ex" },
  { id: "settings", label: "Ajustes", title: "Ajustes del IDE", glyph: "Aj" },
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
            aria-label={item.title}
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
            <span aria-hidden="true">{item.glyph}</span>
          </button>
        );
      })}
    </nav>
  );
}

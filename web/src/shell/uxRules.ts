// Reglas de usabilidad comprobables sin Tauri.

/** Selectores que no deben anidar overflow:auto/scroll entre sí en el workbench. */
export const FORBIDDEN_NESTED_SCROLL_PAIR = [
  [".ide-shell", ".ide-workbench"],
  [".title-bar", ".ide-center"],
] as const;

export function isNestedScrollViolation(
  parentOverflow: string,
  childOverflow: string,
): boolean {
  const scrollish = (value: string) => value === "auto" || value === "scroll";
  return scrollish(parentOverflow) && scrollish(childOverflow);
}

/** Orden de cierre con Esc: menú → paleta → panel inferior → chat → lateral. */
export type EscLayer = "menu" | "palette" | "bottom" | "chat" | "side" | "none";

export function nextEscTarget(state: {
  menuOpen: boolean;
  paletteOpen: boolean;
  bottomOpen: boolean;
  chatOpen: boolean;
  sideOpen: boolean;
}): EscLayer {
  if (state.menuOpen) {
    return "menu";
  }
  if (state.paletteOpen) {
    return "palette";
  }
  if (state.bottomOpen) {
    return "bottom";
  }
  if (state.chatOpen) {
    return "chat";
  }
  if (state.sideOpen) {
    return "side";
  }
  return "none";
}

export function bottomHeightCss(open: boolean, maximized: boolean, frac: number): string {
  if (!open) {
    return "0px";
  }
  if (maximized) {
    return "60%";
  }
  const clamped = Math.min(0.6, Math.max(0.15, frac));
  return `${(clamped * 100).toFixed(1)}%`;
}

export const EXPERT_VIEW_BLURBS: Record<string, { title: string; blurb: string }> = {
  telemetria: {
    title: "Telemetría",
    blurb: "Resumen en vivo del estado del proyecto y del kernel.",
  },
  topologia: {
    title: "Topología",
    blurb: "Mapa de relaciones entre archivos y símbolos del proyecto.",
  },
  ledger: {
    title: "Ledger",
    blurb: "Historial de cambios automáticos del sistema (autopoiesis).",
  },
  lienzo: {
    title: "Lienzo visual",
    blurb: "Constructor gráfico que genera código Shoresh firmado.",
  },
  nucleo: {
    title: "Núcleo AETHER-Ω",
    blurb: "Vistas avanzadas de proyecciones y fases del núcleo.",
  },
};

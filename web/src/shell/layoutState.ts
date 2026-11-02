// Persistencia de paneles abiertos (sin secretos).

const KEY = "bara.panels.v2";

export type SideMode = "files" | "search" | "settings" | null;

export type BottomTab =
  | "resumen"
  | "tokens"
  | "problemas"
  | "git"
  | "oraculo"
  | "catalogo"
  | "bilattice"
  | "telemetria"
  | "topologia"
  | "ledger"
  | "lienzo"
  | "nucleo";

export interface PanelLayout {
  sideMode: SideMode;
  chatOpen: boolean;
  bottomOpen: boolean;
  bottomMaximized: boolean;
  bottomFrac: number;
  sideFrac: number;
  chatFrac: number;
  bottomTab: BottomTab;
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  sideMode: "files",
  chatOpen: true,
  bottomOpen: false,
  bottomMaximized: false,
  bottomFrac: 0.35,
  sideFrac: 0.18,
  // Chat centro = panel principal; editor a la derecha más estrecho.
  chatFrac: 0.48,
  bottomTab: "resumen",
};

export function loadPanelLayout(): PanelLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return { ...DEFAULT_PANEL_LAYOUT };
    }
    const parsed = JSON.parse(raw) as Partial<PanelLayout>;
    return {
      ...DEFAULT_PANEL_LAYOUT,
      ...parsed,
      bottomFrac: clamp(parsed.bottomFrac ?? 0.35, 0.15, 0.6),
      sideFrac: clamp(parsed.sideFrac ?? 0.18, 0.12, 0.32),
      chatFrac: clamp(parsed.chatFrac ?? 0.48, 0.32, 0.62),
    };
  } catch {
    return { ...DEFAULT_PANEL_LAYOUT };
  }
}

export function savePanelLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...layout,
        bottomFrac: clamp(layout.bottomFrac, 0.15, 0.6),
      }),
    );
  } catch {
    // almacén cerrado
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Persistencia de paneles abiertos (sin secretos).

const KEY = "bara.panels.v2";
const LEGACY_KEY = "bara.panels.v1";

export type SideMode = "files" | "search" | "settings" | null;

export type BottomTab =
  | "resumen"
  | "tokens"
  | "problemas"
  | "git"
  | "mapa"
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
  /** true: el editor queda a la izquierda y el chat a la derecha. */
  editorFirst: boolean;
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
  editorFirst: false,
};

const BOTTOM_TABS = new Set<BottomTab>([
  "resumen",
  "tokens",
  "problemas",
  "git",
  "mapa",
  "oraculo",
  "catalogo",
  "bilattice",
  "telemetria",
  "topologia",
  "ledger",
  "lienzo",
  "nucleo",
]);

function normalize(parsed: Partial<PanelLayout>): PanelLayout {
  const bottomTab = BOTTOM_TABS.has(parsed.bottomTab as BottomTab)
    ? (parsed.bottomTab as BottomTab)
    : DEFAULT_PANEL_LAYOUT.bottomTab;
  const sideMode =
    parsed.sideMode === "files" ||
    parsed.sideMode === "search" ||
    parsed.sideMode === "settings" ||
    parsed.sideMode === null
      ? parsed.sideMode
      : DEFAULT_PANEL_LAYOUT.sideMode;
  return {
    ...DEFAULT_PANEL_LAYOUT,
    ...parsed,
    sideMode,
    bottomTab,
    bottomFrac: clamp(parsed.bottomFrac ?? 0.35, 0.15, 0.6),
    sideFrac: clamp(parsed.sideFrac ?? 0.18, 0.12, 0.32),
    chatFrac: clamp(parsed.chatFrac ?? 0.48, 0.32, 0.62),
    editorFirst: parsed.editorFirst === true,
  };
}

export function loadPanelLayout(): PanelLayout {
  try {
    const current = localStorage.getItem(KEY);
    if (current) {
      return normalize(JSON.parse(current) as Partial<PanelLayout>);
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) {
      return { ...DEFAULT_PANEL_LAYOUT };
    }
    const migrated = normalize(JSON.parse(legacy) as Partial<PanelLayout>);
    savePanelLayout(migrated);
    return migrated;
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

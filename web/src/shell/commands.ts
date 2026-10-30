// Catálogo de la paleta: acciones buscables en español.

import type { BottomTab, SideMode } from "./layoutState";

export interface CommandAction {
  id: string;
  label: string;
  keywords?: string;
  run: () => void;
}

export interface CommandHandlers {
  toggleSide: (mode: Exclude<SideMode, null>) => void;
  toggleChat: () => void;
  toggleBottom: () => void;
  openBottomTab: (tab: BottomTab) => void;
  openPalette: () => void;
  openAssistMedia: () => void;
  save: () => void;
  openFolder: () => void;
  focusEditor: () => void;
  maximizeBottom: () => void;
  minimizeBottom: () => void;
  closeBottom: () => void;
  closeMenus: () => void;
}

/** Lista completa de acciones de la paleta. */
export function buildCommands(h: CommandHandlers): CommandAction[] {
  return [
    { id: "palette", label: "Paleta de comandos", keywords: "buscar acción", run: h.openPalette },
    { id: "save", label: "Guardar documento", keywords: "ctrl s", run: h.save },
    { id: "open-folder", label: "Abrir carpeta…", keywords: "workspace explorador", run: h.openFolder },
    { id: "files", label: "Mostrar u ocultar Archivos", keywords: "explorador lateral", run: () => h.toggleSide("files") },
    { id: "search", label: "Mostrar u ocultar Buscar", keywords: "filtrar archivos", run: () => h.toggleSide("search") },
    { id: "settings", label: "Mostrar u ocultar Ajustes", keywords: "preferencias", run: () => h.toggleSide("settings") },
    { id: "chat", label: "Mostrar u ocultar Chat", keywords: "asistente derecha", run: h.toggleChat },
    { id: "bottom", label: "Mostrar u ocultar panel inferior", keywords: "terminal ctrl j", run: h.toggleBottom },
    { id: "bottom-max", label: "Maximizar panel inferior", keywords: "60%", run: h.maximizeBottom },
    { id: "bottom-min", label: "Minimizar panel inferior", keywords: "solo pestañas", run: h.minimizeBottom },
    { id: "bottom-close", label: "Cerrar panel inferior", keywords: "x", run: h.closeBottom },
    { id: "focus-editor", label: "Enfocar el editor", keywords: "centro", run: h.focusEditor },
    { id: "tab-resumen", label: "Panel: Resumen del análisis", keywords: "kernel", run: () => h.openBottomTab("resumen") },
    { id: "tab-tokens", label: "Panel: Tokens", keywords: "léxico", run: () => h.openBottomTab("tokens") },
    { id: "tab-oraculo", label: "Panel: Oráculo", keywords: "consulta", run: () => h.openBottomTab("oraculo") },
    { id: "tab-catalogo", label: "Panel: Catálogo de raíces", keywords: "shoresh", run: () => h.openBottomTab("catalogo") },
    { id: "tab-bilattice", label: "Panel: Bilattice (verdad/falsedad)", keywords: "belnap", run: () => h.openBottomTab("bilattice") },
    {
      id: "tab-telemetria",
      label: "Panel: Telemetría",
      keywords: "cockpit censo",
      run: () => h.openBottomTab("telemetria"),
    },
    {
      id: "tab-topologia",
      label: "Vista experta: Topología del grafo",
      keywords: "red nodos",
      run: () => h.openBottomTab("topologia"),
    },
    {
      id: "tab-ledger",
      label: "Vista experta: Ledger (autopoiesis)",
      keywords: "historial",
      run: () => h.openBottomTab("ledger"),
    },
    {
      id: "tab-lienzo",
      label: "Vista experta: Lienzo visual",
      keywords: "constructor",
      run: () => h.openBottomTab("lienzo"),
    },
    {
      id: "tab-nucleo",
      label: "Vista experta: Núcleo AETHER-Ω",
      keywords: "proyecciones",
      run: () => h.openBottomTab("nucleo"),
    },
    {
      id: "assist-media",
      label: "Asistencia: adjuntar imagen, vídeo o fragmento",
      keywords: "medios",
      run: h.openAssistMedia,
    },
    { id: "close-menus", label: "Cerrar menús abiertos", keywords: "esc", run: h.closeMenus },
  ];
}

/** Filtra comandos por texto libre (nombre y palabras clave). */
export function filterCommands(commands: CommandAction[], query: string): CommandAction[] {
  const q = query.trim().toLocaleLowerCase("es");
  if (!q) {
    return commands;
  }
  return commands.filter((cmd) => {
    const hay = `${cmd.label} ${cmd.keywords ?? ""} ${cmd.id}`.toLocaleLowerCase("es");
    return hay.includes(q);
  });
}

// Recuerda tamaño y posición de la ventana principal (localStorage, sin secretos).

const KEY = "bara.window.main.v1";

export interface WindowGeometry {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

export function loadWindowGeometry(): WindowGeometry | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as WindowGeometry;
    if (
      typeof parsed.width !== "number" ||
      typeof parsed.height !== "number" ||
      parsed.width < 640 ||
      parsed.height < 480
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWindowGeometry(geometry: WindowGeometry): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(geometry));
  } catch {
    // almacén cerrado
  }
}

/** Si está maximizada se conserva el tamaño restaurado; si no, se guarda el tamaño vivo. */
export function rememberGeometry(
  live: { maximized: boolean; width: number; height: number; x: number; y: number },
  previous: WindowGeometry | null,
): WindowGeometry {
  if (live.maximized) {
    return {
      width: previous?.width ?? live.width,
      height: previous?.height ?? live.height,
      x: previous?.x ?? live.x,
      y: previous?.y ?? live.y,
      maximized: true,
    };
  }
  return {
    width: live.width,
    height: live.height,
    x: live.x,
    y: live.y,
    maximized: false,
  };
}

/** Ajusta la ventana Tauri al monitor y restaura geometría guardada. */
export async function restoreMainWindow(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }
  const { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } = await import(
    "@tauri-apps/api/window"
  );
  const current = getCurrentWindow();
  if (current.label !== "main") {
    return;
  }
  const saved = loadWindowGeometry();
  try {
    const monitor = await currentMonitor();
    const screenW = monitor?.size.width ?? 1366;
    const screenH = monitor?.size.height ?? 768;
    const scale = monitor?.scaleFactor ?? 1;
    const availW = Math.floor(screenW / scale);
    const availH = Math.floor(screenH / scale);

    const width = Math.min(saved?.width ?? Math.min(1280, availW - 40), availW);
    const height = Math.min(saved?.height ?? Math.min(720, availH - 60), availH);
    // Arranque maximizado (monitor ≤1440 o preferencia guardada). El tamaño
    // restaurado queda escrito antes, y los listeners se registran igual.
    if (saved?.maximized || (saved === null && availW <= 1440)) {
      if (saved === null) {
        saveWindowGeometry({ width, height, maximized: true });
      }
      await current.maximize();
    } else {
      await current.setSize(new LogicalSize(width, height));
      if (typeof saved?.x === "number" && typeof saved?.y === "number") {
        await current.setPosition(new LogicalPosition(saved.x, saved.y));
      } else {
        await current.center();
      }
    }
  } catch {
    // Sin permisos de ventana: se queda el tamaño de tauri.conf.
  }

  const persist = async () => {
    try {
      const maximized = await current.isMaximized();
      const size = await current.outerSize();
      const pos = await current.outerPosition();
      const factor = await current.scaleFactor();
      saveWindowGeometry(
        rememberGeometry(
          {
            maximized,
            width: Math.round(size.width / factor),
            height: Math.round(size.height / factor),
            x: Math.round(pos.x / factor),
            y: Math.round(pos.y / factor),
          },
          loadWindowGeometry(),
        ),
      );
    } catch {
      // ignore
    }
  };

  await current.onResized(() => {
    void persist();
  });
  await current.onMoved(() => {
    void persist();
  });
}

// Escritura al portapapeles: plugin Tauri (solo write) o fallback WebView.

/** Copia texto al portapapeles. Nunca lee el portapapeles. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    }
  } catch {
    // cae al fallback
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

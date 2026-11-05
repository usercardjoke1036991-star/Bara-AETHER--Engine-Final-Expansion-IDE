import { getVersion } from "@tauri-apps/api/app";

import packageJson from "../../../package.json";

/** Prefija «v» sin escribir el número en el código. */
export function formatAppVersion(raw: string): string {
  const version = raw.trim();
  if (!version) {
    return "";
  }
  return version.startsWith("v") ? version : `v${version}`;
}

/**
 * Versión de la app instalada. Tauri getVersion lee tauri.conf.json;
 * sin runtime (tests, vite preview) se usa package.json.
 */
export async function readAppVersion(): Promise<string> {
  try {
    const fromRuntime = formatAppVersion(await getVersion());
    if (fromRuntime) {
      return fromRuntime;
    }
  } catch {
    // getVersion lanza fuera del webview de Tauri.
  }
  return formatAppVersion(packageJson.version);
}

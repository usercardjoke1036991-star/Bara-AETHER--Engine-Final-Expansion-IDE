// Configuración del cliente de IA: valores por defecto, variables de entorno y
// persistencia **opcional** de la clave.
//
// Orden de prioridad de la clave:
//   1. lo que el usuario escriba en el panel (memoria de la sesión);
//   2. la copia guardada en el navegador, **sólo** si activó «recordar»;
//   3. las variables `VITE_*` del entorno de desarrollo.
//
// Aviso honesto que el panel repite al usuario: un WebView no puede proteger una
// clave frente a quien controle la máquina o inyecte código en la página. Por eso
// el IDE (a) no recuerda la clave salvo que se le pida, (b) permite apuntar
// `baseUrl` a un proxy propio y (c) nunca imprime la clave en errores ni logs.

import type { AiConfig, ProviderId } from "./types";

/** Clave de `localStorage` (versionada: cambiar el formato no rompe nada). */
export const STORAGE_KEY = "bara-ide.ai.config.v1";

/** Raíz de la API por defecto de cada proveedor. */
export const PROVIDER_ENDPOINTS: Record<ProviderId, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

/** Nombre visible de cada proveedor. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic · Claude (Messages API)",
  openai: "OpenAI o compatible (Chat Completions · visión)",
};

/** Variables de entorno que la interfaz acepta como clave (sólo desarrollo). */
export const PROVIDER_ENV_KEYS: Record<ProviderId, string> = {
  anthropic: "VITE_ANTHROPIC_API_KEY",
  openai: "VITE_OPENAI_API_KEY",
};

/**
 * Modelos sugeridos. Se toman de los ejemplos de la documentación oficial y
 * **no** se dan por válidos: el panel ofrece «Detectar modelos», que consulta
 * `GET /models` del proveedor y devuelve la lista real de la cuenta.
 */
export const PROVIDER_MODEL_PRESETS: Record<ProviderId, string[]> = {
  anthropic: ["claude-opus-5-5"],
  openai: ["gpt-5.6-sol", "gpt-6-astra"],
};

/** Versión de la Messages API que habla este cliente. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** Cabecera que autoriza a la API de Anthropic a responder a un navegador. */
export const ANTHROPIC_BROWSER_HEADER = "anthropic-dangerous-direct-browser-access";

/** Configuración de fábrica (Anthropic y sin clave: la pone el usuario). */
export const DEFAULT_CONFIG: AiConfig = {
  provider: "anthropic",
  model: PROVIDER_MODEL_PRESETS.anthropic[0],
  apiKey: "",
  baseUrl: PROVIDER_ENDPOINTS.anthropic,
  maxTokens: 2048,
  temperature: null,
  useMaxCompletionTokens: true,
  rememberKey: false,
};

/** Rango de tokens que el panel acepta. */
export const TOKEN_RANGE = { min: 256, max: 8192 };

/** Almacén mínimo compatible con `localStorage` (inyectable para probarlo). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Devuelve `localStorage` si el entorno lo ofrece; nunca lanza. */
export function defaultStore(): KeyValueStore | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Lee una variable `VITE_*` sin romper en entornos sin `import.meta.env`. */
export function envValue(name: string): string {
  const meta = import.meta as ImportMeta & { env?: Record<string, unknown> };
  const value = meta.env ? meta.env[name] : undefined;
  return typeof value === "string" ? value : "";
}

/** Clave del entorno adecuada al proveedor activo. */
export function envKeyFor(provider: ProviderId): string {
  return envValue(PROVIDER_ENV_KEYS[provider]).trim();
}

/** Convierte cualquier JSON leído del almacén en una configuración válida. */
export function sanitizeConfig(raw: unknown): Partial<AiConfig> | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const out: Partial<AiConfig> = {};
  if (source.provider === "anthropic" || source.provider === "openai") {
    out.provider = source.provider;
  }
  if (typeof source.model === "string") {
    out.model = source.model;
  }
  if (typeof source.apiKey === "string") {
    out.apiKey = source.apiKey;
  }
  if (typeof source.baseUrl === "string") {
    out.baseUrl = source.baseUrl;
  }
  if (typeof source.maxTokens === "number" && Number.isFinite(source.maxTokens)) {
    out.maxTokens = source.maxTokens;
  }
  if (typeof source.temperature === "number" && Number.isFinite(source.temperature)) {
    out.temperature = source.temperature;
  }
  if (typeof source.useMaxCompletionTokens === "boolean") {
    out.useMaxCompletionTokens = source.useMaxCompletionTokens;
  }
  if (typeof source.rememberKey === "boolean") {
    out.rememberKey = source.rememberKey;
  }
  return out;
}

/** Configuración guardada en el almacén, si la hay y es legible. */
export function loadStoredConfig(
  store: KeyValueStore | null = defaultStore(),
): Partial<AiConfig> | null {
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? sanitizeConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Configuración de arranque: fábrica + almacén + entorno. */
export function loadConfig(store: KeyValueStore | null = defaultStore()): AiConfig {
  const stored = loadStoredConfig(store);
  const config: AiConfig = { ...DEFAULT_CONFIG, ...(stored ?? {}) };
  if (!config.apiKey) {
    config.apiKey = envKeyFor(config.provider);
  }
  return config;
}

/** Guarda la configuración; la clave sólo se escribe si se pidió recordarla. */
export function saveConfig(
  config: AiConfig,
  store: KeyValueStore | null = defaultStore(),
): boolean {
  if (!store) {
    return false;
  }
  try {
    const persistible: AiConfig = { ...config, apiKey: config.rememberKey ? config.apiKey : "" };
    store.setItem(STORAGE_KEY, JSON.stringify(persistible));
    return true;
  } catch {
    return false;
  }
}

/** Borra la configuración guardada (incluida cualquier clave persistida). */
export function forgetConfig(store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) {
    return false;
  }
  try {
    store.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Cambia de proveedor: raíz y modelo de fábrica y **sin** clave heredada. */
export function withProvider(config: AiConfig, provider: ProviderId): AiConfig {
  if (config.provider === provider) {
    return config;
  }
  return {
    ...config,
    provider,
    apiKey: envKeyFor(provider),
    model: PROVIDER_MODEL_PRESETS[provider][0],
    baseUrl: PROVIDER_ENDPOINTS[provider],
  };
}

/** Clave enmascarada para poder mostrarla sin revelarla. */
export function maskSecret(secret: string): string {
  const value = secret.trim();
  if (!value) {
    return "(sin clave)";
  }
  if (value.length <= 8) {
    return "•".repeat(value.length);
  }
  return `${value.slice(0, 4)}${"•".repeat(8)}${value.slice(-4)}`;
}

/** Problemas de configuración que impiden enviar (lista vacía = todo listo). */
export function configProblems(config: AiConfig): string[] {
  const problems: string[] = [];
  if (!config.model.trim()) {
    problems.push("Falta el modelo: escríbelo o usa «Detectar modelos».");
  }
  if (!config.apiKey.trim()) {
    problems.push("Falta la clave de API del proveedor activo.");
  }
  if (!/^https?:\/\//i.test(config.baseUrl.trim())) {
    problems.push("La raíz de la API debe empezar por http:// o https://.");
  }
  const { min, max } = TOKEN_RANGE;
  if (!Number.isFinite(config.maxTokens) || config.maxTokens < min || config.maxTokens > max) {
    problems.push(`Los tokens máximos deben estar entre ${min} y ${max}.`);
  }
  if (config.temperature !== null && (config.temperature < 0 || config.temperature > 1)) {
    problems.push("La temperatura debe estar entre 0 y 1.");
  }
  return problems;
}

/** Línea de estado legible para el encabezado del panel. */
export function describeConfig(config: AiConfig): string {
  const where = config.rememberKey ? "guardada en el navegador" : "sólo en esta sesión";
  const model = config.model.trim() || "(sin modelo)";
  return `${PROVIDER_LABELS[config.provider]} · ${model} · clave ${maskSecret(config.apiKey)} (${where})`;
}

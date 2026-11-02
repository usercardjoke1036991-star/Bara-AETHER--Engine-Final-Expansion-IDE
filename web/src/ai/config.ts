// Configuración del cliente de IA: valores por defecto y persistencia sin secreto.
//
// La clave no se guarda en este almacén. Si una copia vieja todavía la tiene,
// `peekStoredSecret` la entrega una vez para migrarla al llavero y
// `stripStoredSecret` la borra. El proceso es quien la conserva.

import type { AiConfig, ProviderId } from "./types";

/** Clave de `localStorage` (versionada: cambiar el formato no rompe nada). */
export const STORAGE_KEY = "bara-ide.ai.config.v1";

/** Raíz de la API por defecto de cada proveedor. */
export const PROVIDER_ENDPOINTS: Record<ProviderId, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
};

/** Nombre visible de cada proveedor. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic · Claude (Messages API)",
  openai: "OpenAI (Chat Completions · visión)",
  deepseek: "DeepSeek (OpenAI-compatible)",
};

/**
 * Modelos sugeridos oficiales. No sustituyen `GET /models`: si hay lista viva
 * y el modelo no está en ella, el envío se bloquea hasta listar/elegir.
 */
export const PROVIDER_MODEL_PRESETS: Record<ProviderId, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};

/** Raíz oficial DeepSeek (también acepta `/v1`). */
export const DEEPSEEK_ROOTS: readonly string[] = [
  "https://api.deepseek.com",
  "https://api.deepseek.com/v1",
];

/** Versión de la Messages API que habla este cliente. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** Cabecera histórica de Anthropic. El proceso ya no la envía: no habla un navegador. */
export const ANTHROPIC_BROWSER_HEADER = "anthropic-dangerous-direct-browser-access";

/** Configuración de fábrica (sin modelo inventado: el usuario lista o elige). */
export const DEFAULT_CONFIG: AiConfig = {
  provider: "deepseek",
  model: "",
  apiKey: "",
  hasKey: false,
  baseUrl: PROVIDER_ENDPOINTS.deepseek,
  maxTokens: 2048,
  temperature: null,
  useMaxCompletionTokens: false,
  rememberKey: false,
};

/** Rango de tokens que el panel acepta. */
export const TOKEN_RANGE = { min: 256, max: 8192 };

/** Anthropic admite 0–1. OpenAI / DeepSeek compatibles, 0–2. */
export function temperatureRange(provider: ProviderId): { min: number; max: number } {
  if (provider === "openai" || provider === "deepseek") {
    return { min: 0, max: 2 };
  }
  return { min: 0, max: 1 };
}

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

/** Convierte cualquier JSON leído del almacén en una configuración válida. */
export function sanitizeConfig(raw: unknown): Partial<AiConfig> | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const out: Partial<AiConfig> = {};
  if (
    source.provider === "anthropic" ||
    source.provider === "openai" ||
    source.provider === "deepseek"
  ) {
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

/** Configuración de arranque. La clave guardada no entra en el objeto. */
export function loadConfig(store: KeyValueStore | null = defaultStore()): AiConfig {
  const stored = loadStoredConfig(store);
  const config: AiConfig = { ...DEFAULT_CONFIG, ...(stored ?? {}), apiKey: "", hasKey: false };
  if (!allowedApiRoot(config.provider, config.baseUrl) && !isLocalApiRoot(config.baseUrl)) {
    config.baseUrl = PROVIDER_ENDPOINTS[config.provider];
  } else if (
    config.provider === "anthropic" &&
    stripTrailingSlashes(config.baseUrl.trim()) === "https://api.anthropic.com"
  ) {
    // La Messages API vive en /v1. Una raíz guardada sin ese segmento
    // recibía 404 y el panel decía que el proveedor no la reconocía.
    config.baseUrl = PROVIDER_ENDPOINTS.anthropic;
  }
  return config;
}

/** Clave que una copia vieja del almacén todavía tiene, si la hay. */
export function peekStoredSecret(
  store: KeyValueStore | null = defaultStore(),
): { provider: ProviderId; secret: string } | null {
  const stored = loadStoredConfig(store);
  const secret = stored?.apiKey?.trim() ?? "";
  if (!secret) {
    return null;
  }
  const provider: ProviderId =
    stored?.provider === "openai"
      ? "openai"
      : stored?.provider === "deepseek"
        ? "deepseek"
        : "anthropic";
  return { provider, secret };
}

/** Borra la clave del almacén sin tocar el resto de los ajustes. */
export function stripStoredSecret(store: KeyValueStore | null = defaultStore()): boolean {
  const stored = loadStoredConfig(store);
  if (!stored?.apiKey) {
    return true;
  }
  const config = loadConfig(store);
  return saveConfig({ ...config, ...stored, apiKey: "", hasKey: false, rememberKey: true }, store);
}

/** Guarda la configuración. La clave no se escribe nunca. */
export function saveConfig(
  config: AiConfig,
  store: KeyValueStore | null = defaultStore(),
): boolean {
  if (!store) {
    return false;
  }
  try {
    const persistible: AiConfig = { ...config, apiKey: "" };
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
    apiKey: "",
    hasKey: false,
    model: "",
    baseUrl: PROVIDER_ENDPOINTS[provider],
    useMaxCompletionTokens: provider === "openai",
  };
}

/** Clave enmascarada. Sirve para un borrador que el usuario acaba de teclear. */
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

/** Quita las barras finales sin una expresión cuantificada. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}

/** Raíces HTTPS permitidas para OpenAI (el proveedor OpenAI puro). */
export const OPENAI_CLOUD_ROOTS: readonly string[] = [PROVIDER_ENDPOINTS.openai];

/** `http` sólo en la máquina local (override explícito del panel). */
export function isLocalApiRoot(value: string): boolean {
  const trimmed = stripTrailingSlashes(value.trim());
  try {
    const url = new URL(trimmed);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

/** En la nube la raíz tiene que coincidir con allowlist (oficiales + DeepSeek + local). */
export function allowedApiRoot(provider: ProviderId, baseUrl: string): boolean {
  const trimmed = stripTrailingSlashes(baseUrl.trim());
  if (isLocalApiRoot(trimmed)) {
    return true;
  }
  if (provider === "anthropic") {
    return (
      trimmed === stripTrailingSlashes(PROVIDER_ENDPOINTS.anthropic) ||
      trimmed === "https://api.anthropic.com"
    );
  }
  if (provider === "deepseek") {
    return DEEPSEEK_ROOTS.some((root) => stripTrailingSlashes(root) === trimmed);
  }
  // OpenAI: raíz oficial; también admite DeepSeek si el usuario pega esa URL
  // (compatible) sin cambiar de proveedor.
  return (
    OPENAI_CLOUD_ROOTS.some((root) => stripTrailingSlashes(root) === trimmed) ||
    DEEPSEEK_ROOTS.some((root) => stripTrailingSlashes(root) === trimmed)
  );
}

/** `https` con anfitrión permitido, o `http` sólo en localhost. Sin credenciales en la URL. */
export function isApiRoot(value: string, provider: ProviderId = "anthropic"): boolean {
  const trimmed = stripTrailingSlashes(value.trim());
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return false;
  }
  if (url.protocol === "https:") {
    return url.hostname.length > 0 && allowedApiRoot(provider, trimmed);
  }
  if (url.protocol === "http:") {
    return isLocalApiRoot(trimmed);
  }
  return false;
}

/**
 * Motivo por el que Enviar no sale, o `null` si el turno puede viajar.
 *
 * El modo offline habla con el núcleo local y no usa la clave ni la raíz.
 * En línea, el primer problema de [`configProblems`] bloquea el envío.
 */
export function chatSendGate(
  config: AiConfig,
  draft: string,
  pending: boolean,
  offline: boolean,
  liveModels: string[] = [],
): string | null {
  if (pending) {
    return "hay un turno en curso";
  }
  if (draft.trim().length === 0) {
    return "el mensaje está vacío";
  }
  if (offline) {
    return null;
  }
  return configProblems(config, liveModels)[0] ?? null;
}

/**
 * Problemas de configuración que impiden enviar (lista vacía = todo listo).
 * `liveModels`: ids de `GET /models` si ya se listaron; vacío = aún no.
 */
export function configProblems(config: AiConfig, liveModels: string[] = []): string[] {
  const problems: string[] = [];
  const model = config.model.trim();
  const presets = PROVIDER_MODEL_PRESETS[config.provider];
  if (!model) {
    problems.push("Falta el modelo: pulsa «listar modelos» o elige un preset oficial.");
  } else if (liveModels.length > 0 && !liveModels.includes(model)) {
    problems.push(
      `El modelo «${model}» no está en la lista viva. Elige uno de «listar modelos» o Probar conexión.`,
    );
  } else if (liveModels.length === 0 && !presets.includes(model)) {
    problems.push(
      "Modelo no reconocido: pulsa «listar modelos» (o elige un preset oficial) antes de enviar.",
    );
  }
  if (!config.hasKey && !config.apiKey.trim()) {
    problems.push("Falta la clave de API del proveedor activo.");
  }
  if (!isApiRoot(config.baseUrl, config.provider)) {
    problems.push(
      "La raíz de la API tiene que ser la oficial del proveedor, DeepSeek o http en localhost.",
    );
  }
  const { min, max } = TOKEN_RANGE;
  if (!Number.isFinite(config.maxTokens) || config.maxTokens < min || config.maxTokens > max) {
    problems.push(`Los tokens máximos deben estar entre ${min} y ${max}.`);
  }
  const heat = temperatureRange(config.provider);
  if (
    config.temperature !== null &&
    (config.temperature < heat.min || config.temperature > heat.max)
  ) {
    problems.push(`La temperatura debe estar entre ${heat.min} y ${heat.max}.`);
  }
  return problems;
}

/** Línea de estado. No incluye el secreto. */
export function describeConfig(config: AiConfig): string {
  const where = config.hasKey || config.apiKey.trim()
    ? config.rememberKey
      ? "en llavero"
      : "sólo en esta sesión"
    : "sin clave";
  const model = config.model.trim() || "(sin modelo)";
  return `${PROVIDER_LABELS[config.provider]} · ${model} · clave ${where}`;
}

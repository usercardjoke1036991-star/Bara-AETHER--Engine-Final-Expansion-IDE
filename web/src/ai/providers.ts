// Cliente HTTP de los dos proveedores multimodales.
//
// La construcción de la petición y el análisis de la respuesta están separados
// del envío: las funciones puras se prueban sin red y sin clave (justo lo que
// hace `selfcheck.ts`, ejecutable también desde Node).
//
// Formas verificadas contra la documentación oficial:
//  · Anthropic Messages: bloque `{type:"image", source:{type:"base64",
//    media_type, data}}`, la **imagen antes del texto**, cabeceras `x-api-key` y
//    `anthropic-version`, más `anthropic-dangerous-direct-browser-access: true`,
//    que es lo que permite a la API atender a un navegador o WebView.
//  · OpenAI Chat Completions: partes `{type:"text"}` y
//    `{type:"image_url", image_url:{url}}`, donde `url` admite una data URL
//    base64; por eso también funciona con servidores compatibles locales.

import { ANTHROPIC_BROWSER_HEADER, ANTHROPIC_VERSION, PROVIDER_ENDPOINTS } from "./config";
import type {
  AiConfig,
  ChatMessage,
  ChatResult,
  ChatUsage,
  ModelInfo,
  ProviderId,
} from "./types";

/** Mensaje ya listo para viajar por el cable. */
export interface WireMessage {
  role: "user" | "assistant";
  text: string;
  images: ChatMessage["images"];
}

/** Turnos de historial que se envían como máximo (los antiguos se recortan). */
export const MAX_WIRE_MESSAGES = 12;

/** Historial que viaja al proveedor: sin turnos fallidos, sin vacíos y acotado. */
export function wireMessages(messages: ChatMessage[], limit = MAX_WIRE_MESSAGES): WireMessage[] {
  return messages
    .filter((message) => message.error === null)
    .filter((message) => message.text.trim().length > 0 || message.images.length > 0)
    .slice(-limit)
    .map((message) => ({ role: message.role, text: message.text, images: message.images }));
}

/** Raíz de la API normalizada (sin barra final); vacía ⇒ la del proveedor. */
export function normalizeBaseUrl(baseUrl: string, fallback: string): string {
  const value = baseUrl.trim() || fallback;
  return value.replace(/\/+$/, "");
}

/** Petición HTTP completa, lista para `fetch`. */
export interface HttpRequest {
  url: string;
  init: RequestInit;
}

/** Cuerpo de una petición a la Messages API de Anthropic. */
export function anthropicBody(
  config: AiConfig,
  messages: WireMessage[],
  system: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model.trim(),
    max_tokens: config.maxTokens,
    messages: messages.map((message) => {
      const content: Record<string, unknown>[] = [];
      // La documentación de Anthropic recomienda la imagen antes del texto.
      for (const image of message.images) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.base64 },
        });
      }
      if (message.text.trim()) {
        content.push({ type: "text", text: message.text });
      }
      return { role: message.role, content };
    }),
  };
  if (system.trim()) {
    body.system = system;
  }
  if (config.temperature !== null) {
    body.temperature = config.temperature;
  }
  return body;
}

/** Petición completa a la Messages API de Anthropic. */
export function anthropicRequest(
  config: AiConfig,
  messages: WireMessage[],
  system: string,
): HttpRequest {
  const base = normalizeBaseUrl(config.baseUrl, PROVIDER_ENDPOINTS.anthropic);
  return {
    url: `${base}/messages`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey.trim(),
        "anthropic-version": ANTHROPIC_VERSION,
        [ANTHROPIC_BROWSER_HEADER]: "true",
      },
      body: JSON.stringify(anthropicBody(config, messages, system)),
    },
  };
}

/** Cuerpo de una petición a `chat/completions` (OpenAI y compatibles). */
export function openAiBody(
  config: AiConfig,
  messages: WireMessage[],
  system: string,
): Record<string, unknown> {
  const wire = messages.map((message) => {
    if (message.images.length === 0) {
      // Texto puro: se envía como cadena para máxima compatibilidad (las
      // pasarelas y servidores locales aceptan mejor la forma simple).
      return { role: message.role, content: message.text };
    }
    const parts: Record<string, unknown>[] = [{ type: "text", text: message.text }];
    for (const image of message.images) {
      parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
    }
    return { role: message.role, content: parts };
  });
  const body: Record<string, unknown> = {
    model: config.model.trim(),
    messages: system.trim() ? [{ role: "system", content: system }, ...wire] : wire,
  };
  // Los modelos de razonamiento exigen `max_completion_tokens`; el interruptor
  // permite volver a `max_tokens` en servidores compatibles más antiguos.
  if (config.useMaxCompletionTokens) {
    body.max_completion_tokens = config.maxTokens;
  } else {
    body.max_tokens = config.maxTokens;
  }
  if (config.temperature !== null) {
    body.temperature = config.temperature;
  }
  return body;
}

/** Petición completa a `chat/completions` (OpenAI y compatibles). */
export function openAiRequest(
  config: AiConfig,
  messages: WireMessage[],
  system: string,
): HttpRequest {
  const base = normalizeBaseUrl(config.baseUrl, PROVIDER_ENDPOINTS.openai);
  return {
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify(openAiBody(config, messages, system)),
    },
  };
}

/** Petición del proveedor activo. */
export function chatRequest(
  config: AiConfig,
  messages: WireMessage[],
  system: string,
): HttpRequest {
  return config.provider === "anthropic"
    ? anthropicRequest(config, messages, system)
    : openAiRequest(config, messages, system);
}

/** Mensaje de error legible de un proveedor, sin filtrar nunca la clave. */
export function extractApiError(status: number, payload: unknown, provider: ProviderId): string {
  const name = provider === "anthropic" ? "Anthropic" : "OpenAI";
  const http = status === 0 ? "sin respuesta del servidor" : `HTTP ${status}`;
  const shape = payload as
    | { error?: { message?: unknown } | string; message?: unknown }
    | null;
  let detail = "";
  if (shape && typeof shape === "object") {
    if (typeof shape.error === "string") {
      detail = shape.error;
    } else if (shape.error && typeof shape.error.message === "string") {
      detail = shape.error.message;
    } else if (typeof shape.message === "string") {
      detail = shape.message;
    }
  }
  return detail ? `${name} (${http}): ${detail}` : `${name} respondió ${http} sin detalle`;
}

/** Consumo de tokens normalizado (`null` si el proveedor no lo informa). */
export function usageOf(input: unknown, output: unknown): ChatUsage | null {
  const a = typeof input === "number" ? input : 0;
  const b = typeof output === "number" ? output : 0;
  return a || b ? { inputTokens: a, outputTokens: b } : null;
}

/** Texto de una respuesta de Anthropic (concatena sus bloques `text`). */
export function parseAnthropicResponse(payload: unknown): ChatResult {
  const body = payload as
    | {
        content?: unknown;
        model?: unknown;
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
      }
    | null;
  const blocks = Array.isArray(body?.content) ? body.content : [];
  const parts: string[] = [];
  for (const block of blocks) {
    const item = block as { type?: unknown; text?: unknown };
    if (item?.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  const text = parts.join("\n").trim();
  if (!text) {
    throw new Error("Anthropic no devolvió texto (¿respuesta vacía o rechazada?)");
  }
  return {
    text,
    model: typeof body?.model === "string" ? body.model : "",
    usage: usageOf(body?.usage?.input_tokens, body?.usage?.output_tokens),
  };
}

/** Texto de una respuesta de `chat/completions` (cadena o partes). */
export function parseOpenAiResponse(payload: unknown): ChatResult {
  const body = payload as
    | {
        choices?: unknown;
        model?: unknown;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      }
    | null;
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  const parts: string[] = [];
  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      const item = part as { text?: unknown };
      if (typeof item?.text === "string") {
        parts.push(item.text);
      }
    }
  }
  const text = parts.join("\n").trim();
  if (!text) {
    throw new Error("el proveedor no devolvió texto (¿respuesta vacía o rechazada?)");
  }
  return {
    text,
    model: typeof body?.model === "string" ? body.model : "",
    usage: usageOf(body?.usage?.prompt_tokens, body?.usage?.completion_tokens),
  };
}

/** Normaliza la respuesta del proveedor activo. */
export function parseChatResponse(provider: ProviderId, payload: unknown): ChatResult {
  return provider === "anthropic"
    ? parseAnthropicResponse(payload)
    : parseOpenAiResponse(payload);
}

/** Cuerpo JSON de una respuesta, tolerando cuerpos vacíos o no-JSON. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Envía la conversación al proveedor activo y normaliza la respuesta.
 *
 * `signal` permite cancelar el turno desde la interfaz (botón «Detener»).
 * Los fallos de red se propagan como `Error` con el detalle del proveedor.
 */
export async function sendChat(
  config: AiConfig,
  messages: ChatMessage[],
  system: string,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const request = chatRequest(config, wireMessages(messages), system);
  const response = await fetch(request.url, { ...request.init, signal });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(extractApiError(response.status, payload, config.provider));
  }
  return parseChatResponse(config.provider, payload);
}

/** Lista real de modelos de la cuenta (`GET {base}/models`). */
export async function listModels(config: AiConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const base = normalizeBaseUrl(config.baseUrl, PROVIDER_ENDPOINTS[config.provider]);
  const anthropic = config.provider === "anthropic";
  const response = await fetch(`${base}/models`, {
    method: "GET",
    headers: anthropic
      ? {
          "x-api-key": config.apiKey.trim(),
          "anthropic-version": ANTHROPIC_VERSION,
          [ANTHROPIC_BROWSER_HEADER]: "true",
        }
      : { authorization: `Bearer ${config.apiKey.trim()}` },
    signal,
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(extractApiError(response.status, payload, config.provider));
  }
  const body = payload as { data?: unknown } | null;
  const rows = Array.isArray(body?.data) ? body.data : [];
  const models: ModelInfo[] = [];
  for (const row of rows) {
    const item = row as { id?: unknown; display_name?: unknown };
    if (typeof item?.id !== "string") {
      continue;
    }
    models.push({
      id: item.id,
      label: typeof item.display_name === "string" ? `${item.display_name} · ${item.id}` : item.id,
    });
  }
  models.sort((left, right) => left.id.localeCompare(right.id));
  return models;
}

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

import {
  ANTHROPIC_VERSION,
  PROVIDER_ENDPOINTS,
  stripTrailingSlashes,
} from "./config";
import { exchange } from "./keyring";
import {
  MAX_TOOL_ROUNDS,
  anthropicTools,
  openAiTools,
  parseToolLeakAsCalls,
  runToolCall,
  sanitizeAssistantText,
  type ToolCall,
  type ToolExecutor,
} from "./tools";
import type {
  AiConfig,
  ChatMessage,
  ChatResult,
  ChatToolCall,
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

/**
 * Turno en el hilo de tools (OpenAI/Anthropic). Incluye assistant+tool_calls y
 * role `tool` / `user`+tool_result.
 */
export type ToolWireTurn =
  | { role: "user" | "assistant"; text: string; images: ChatMessage["images"] }
  | { role: "assistant_tools"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** Turnos de historial que se envían como máximo (los antiguos se recortan). */
export const MAX_WIRE_MESSAGES = 6;

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
  return stripTrailingSlashes(value);
}

/**
 * Nombre que viaja en el cuerpo. `proveedor:modelo-del-proveedor` es un id de
 * catálogo (p. ej. `deepseek:deepseek-v4-flash`); la API quiere el segundo
 * tramo. Una etiqueta de versión (`llama3:latest`) se conserva.
 */
export function catalogModelId(model: string): string {
  const value = model.trim();
  const colon = value.indexOf(":");
  if (colon <= 0 || value.includes(":", colon + 1)) {
    return value;
  }
  const vendor = value.slice(0, colon);
  const slug = value.slice(colon + 1);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(vendor) || !/^[a-z0-9][a-z0-9._/-]*$/i.test(slug)) {
    return value;
  }
  if (slug === vendor || slug.startsWith(`${vendor}-`) || slug.startsWith(`${vendor}/`)) {
    return slug;
  }
  return value;
}

/** Modelos que el proveedor enumera en un HTTP 400 de nombre no admitido. */
export function supportedModelNames(detail: string): string[] {
  const match = detail.match(/supported API model names are (.+?), but you passed/i);
  if (!match) {
    return [];
  }
  const names: string[] = [];
  for (const part of match[1].split(",")) {
    const name = part.trim();
    if (name) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Elige, entre los nombres que el servidor acaba de enumerar, el que corresponde
 * al modelo pedido. Sin una pista común (`flash`, `pro`, …) no adivina.
 */
export function closestSupportedModel(requested: string, supported: string[]): string | null {
  const wanted = catalogModelId(requested).toLowerCase();
  for (const name of supported) {
    if (name.toLowerCase() === wanted) {
      return name;
    }
  }
  const hints = ["flash", "pro", "reasoner", "chat", "coder"];
  for (const hint of hints) {
    if (!wanted.includes(hint)) {
      continue;
    }
    for (const name of supported) {
      if (name.toLowerCase().includes(hint)) {
        return name;
      }
    }
  }
  return null;
}

/** Un intento original y, como mucho, un reintento. */
export const CHAT_ATTEMPT_LIMIT = 2;

/** Plazo de todo el intercambio, incluido el reintento. Entre 60 s y 120 s. */
export const CHAT_TIMEOUT_MS = 90_000;

/** Qué hacer tras un fallo HTTP, o `null` si no hay que reintentar. */
export type ChatRetry = { kind: "model"; model: string } | { kind: "transient" };

/**
 * Un solo reintento: o el modelo que el 400 nombra, o un fallo transitorio.
 * Un 400 sin modelo admitido, un 401 y el segundo fallo no se reintentan.
 */
export function chatRetry(
  status: number,
  detail: string,
  requested: string,
  attempt: number,
): ChatRetry | null {
  if (attempt >= CHAT_ATTEMPT_LIMIT) {
    return null;
  }
  const accepted = modelAcceptedByError(status, detail, requested);
  if (accepted) {
    return { kind: "model", model: accepted };
  }
  if (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return { kind: "transient" };
  }
  return null;
}

/** Nombre con el que reintentar tras un 400, o `null` si no hay uno distinto. */
export function modelAcceptedByError(status: number, detail: string, requested: string): string | null {
  if (status !== 400) {
    return null;
  }
  const next = closestSupportedModel(requested, supportedModelNames(detail));
  if (!next || next.toLowerCase() === catalogModelId(requested).toLowerCase()) {
    return null;
  }
  return next;
}

/** Petición HTTP completa, lista para `fetch`. */
export interface HttpRequest {
  url: string;
  init: RequestInit;
}

/** Cuerpo de una petición a la Messages API de Anthropic. */
export function anthropicBody(
  config: AiConfig,
  messages: WireMessage[] | ToolWireTurn[],
  system: string,
  withTools = true,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: catalogModelId(config.model),
    max_tokens: config.maxTokens,
    messages: toAnthropicMessages(messages),
  };
  if (system.trim()) {
    body.system = system;
  }
  if (config.temperature !== null) {
    body.temperature = config.temperature;
  }
  if (withTools) {
    body.tools = anthropicTools();
  }
  return body;
}

/** Petición completa a la Messages API de Anthropic. */
export function anthropicRequest(
  config: AiConfig,
  messages: WireMessage[] | ToolWireTurn[],
  system: string,
  withTools = true,
): HttpRequest {
  const base = normalizeBaseUrl(config.baseUrl, PROVIDER_ENDPOINTS.anthropic);
  return {
    url: `${base}/messages`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(anthropicBody(config, messages, system, withTools)),
    },
  };
}

function toAnthropicMessages(
  messages: WireMessage[] | ToolWireTurn[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const message of messages) {
    if ("images" in message && (message.role === "user" || message.role === "assistant")) {
      const content: Record<string, unknown>[] = [];
      for (const image of message.images) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.base64 },
        });
      }
      if (message.text.trim()) {
        content.push({ type: "text", text: message.text });
      }
      out.push({ role: message.role, content });
      continue;
    }
    const turn = message as ToolWireTurn;
    if (turn.role === "assistant_tools") {
      const content: Record<string, unknown>[] = [];
      if (turn.text.trim()) {
        content.push({ type: "text", text: turn.text });
      }
      for (const call of turn.toolCalls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch {
          input = { raw: call.arguments };
        }
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input,
        });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    if (turn.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: turn.toolCallId,
            content: turn.content,
          },
        ],
      });
    }
  }
  return out;
}

/** ¿La raíz apunta a DeepSeek (oficial o con `/v1`)? */
export function isDeepSeekRoot(baseUrl: string): boolean {
  try {
    return new URL(normalizeBaseUrl(baseUrl, PROVIDER_ENDPOINTS.openai)).hostname === "api.deepseek.com";
  } catch {
    return false;
  }
}

/**
 * Raíz OpenAI-compatible lista para concatenar `/chat/completions` o `/models`.
 *
 * DeepSeek acepta `https://api.deepseek.com` **sin** `/v1` (docs oficiales).
 * Si el usuario guardó `…/v1`, se conserva una sola vez: nunca `…/v1/v1/…`.
 * OpenAI oficial sigue yendo a `https://api.openai.com/v1`.
 */
export function openAiCompatibleRoot(baseUrl: string): string {
  const fallback = PROVIDER_ENDPOINTS.openai;
  let root = normalizeBaseUrl(baseUrl, fallback);
  try {
    const url = new URL(root);
    if (url.hostname === "api.deepseek.com") {
      // Quita un `/v1` final sobrante; la petición añade `/chat/completions`.
      if (url.pathname === "/v1" || url.pathname === "/v1/") {
        url.pathname = "";
      }
      return stripTrailingSlashes(url.toString());
    }
    if (url.hostname === "api.openai.com" && (url.pathname === "" || url.pathname === "/")) {
      return PROVIDER_ENDPOINTS.openai;
    }
  } catch {
    return root;
  }
  return root;
}

/** Cuerpo de una petición a `chat/completions` (OpenAI y compatibles). */
export function openAiBody(
  config: AiConfig,
  messages: WireMessage[] | ToolWireTurn[],
  system: string,
  withTools = true,
): Record<string, unknown> {
  const wire = toOpenAiMessages(messages);
  const body: Record<string, unknown> = {
    model: catalogModelId(config.model),
    messages: system.trim() ? [{ role: "system", content: system }, ...wire] : wire,
  };
  // Los modelos de razonamiento de OpenAI exigen `max_completion_tokens`.
  // DeepSeek rechaza ese campo y sólo acepta `max_tokens`.
  const deepseek = isDeepSeekRoot(config.baseUrl);
  if (config.useMaxCompletionTokens && !deepseek) {
    body.max_completion_tokens = config.maxTokens;
  } else {
    body.max_tokens = config.maxTokens;
  }
  if (config.temperature !== null) {
    body.temperature = config.temperature;
  }
  if (withTools) {
    body.tools = openAiTools();
    body.tool_choice = "auto";
  }
  return body;
}

function toOpenAiMessages(
  messages: WireMessage[] | ToolWireTurn[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const message of messages) {
    if ("images" in message && (message.role === "user" || message.role === "assistant")) {
      if (message.images.length === 0) {
        out.push({ role: message.role, content: message.text });
      } else {
        const parts: Record<string, unknown>[] = [{ type: "text", text: message.text }];
        for (const image of message.images) {
          parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
        }
        out.push({ role: message.role, content: parts });
      }
      continue;
    }
    const turn = message as ToolWireTurn;
    if (turn.role === "assistant_tools") {
      out.push({
        role: "assistant",
        content: turn.text.trim() ? turn.text : null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      continue;
    }
    if (turn.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: turn.toolCallId,
        name: turn.name,
        content: turn.content,
      });
    }
  }
  return out;
}

/** Petición completa a `chat/completions` (OpenAI y compatibles). */
export function openAiRequest(
  config: AiConfig,
  messages: WireMessage[] | ToolWireTurn[],
  system: string,
  withTools = true,
): HttpRequest {
  const base = openAiCompatibleRoot(config.baseUrl);
  return {
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(openAiBody(config, messages, system, withTools)),
    },
  };
}

/** Petición del proveedor activo. */
export function chatRequest(
  config: AiConfig,
  messages: WireMessage[] | ToolWireTurn[],
  system: string,
  withTools = true,
): HttpRequest {
  return config.provider === "anthropic"
    ? anthropicRequest(config, messages, system, withTools)
    : openAiRequest(config, messages, system, withTools);
}

/** Mensaje de error legible de un proveedor, sin filtrar nunca la clave. */
export function extractApiError(status: number, payload: unknown, provider: ProviderId): string {
  const name = provider === "anthropic" ? "Anthropic" : "OpenAI/compatible";
  const shape = payload as
    | { error?: { message?: unknown; code?: unknown; type?: unknown } | string; message?: unknown }
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
  const lower = detail.toLowerCase();
  if (status === 401 || lower.includes("invalid api key") || lower.includes("authentication")) {
    return detail
      ? `clave inválida (HTTP 401): ${detail}`
      : "clave inválida (HTTP 401): el proveedor rechazó la autenticación";
  }
  if (status === 404 || (lower.includes("model") && lower.includes("not found"))) {
    return detail
      ? `modelo no encontrado (HTTP 404): ${detail}`
      : "modelo no encontrado (HTTP 404)";
  }
  if (status === 408 || status === 504) {
    return "tiempo de espera agotado al hablar con el proveedor";
  }
  if (status === 0) {
    return detail || "sin respuesta del servidor";
  }
  const http = `HTTP ${status}`;
  return detail ? `${name} (${http}): ${detail}` : `${name} respondió ${http} sin detalle`;
}

/** Consumo de tokens normalizado (`null` si el proveedor no lo informa). */
export function usageOf(input: unknown, output: unknown): ChatUsage | null {
  const a = typeof input === "number" ? input : 0;
  const b = typeof output === "number" ? output : 0;
  return a || b ? { inputTokens: a, outputTokens: b } : null;
}

/** Texto de una respuesta de Anthropic (concatena sus bloques `text` + tool_use). */
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
  const toolCalls: ChatToolCall[] = [];
  for (const block of blocks) {
    const item = block as {
      type?: unknown;
      text?: unknown;
      id?: unknown;
      name?: unknown;
      input?: unknown;
    };
    if (item?.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
    if (item?.type === "tool_use" && typeof item.name === "string") {
      toolCalls.push({
        id: typeof item.id === "string" ? item.id : `tool-${toolCalls.length + 1}`,
        name: item.name,
        arguments: JSON.stringify(item.input ?? {}),
      });
    }
  }
  const text = parts.join("\n").trim();
  if (!text && toolCalls.length === 0) {
    throw new Error("Anthropic no devolvió texto (¿respuesta vacía o rechazada?)");
  }
  return {
    text,
    model: typeof body?.model === "string" ? body.model : "",
    usage: usageOf(body?.usage?.input_tokens, body?.usage?.output_tokens),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/** Texto de una respuesta de `chat/completions` (cadena, partes o tool_calls). */
export function parseOpenAiResponse(payload: unknown): ChatResult {
  const body = payload as
    | {
        choices?: unknown;
        model?: unknown;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      }
    | null;
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const first = choices[0] as
    | {
        message?: {
          content?: unknown;
          tool_calls?: unknown;
        };
      }
    | undefined;
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
  const toolCalls = parseOpenAiToolCalls(first?.message?.tool_calls);
  const text = parts.join("\n").trim();
  if (!text && toolCalls.length === 0) {
    throw new Error("el proveedor no devolvió texto (¿respuesta vacía o rechazada?)");
  }
  return {
    text,
    model: typeof body?.model === "string" ? body.model : "",
    usage: usageOf(body?.usage?.prompt_tokens, body?.usage?.completion_tokens),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/** Extrae `tool_calls` del mensaje OpenAI. */
export function parseOpenAiToolCalls(raw: unknown): ChatToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const calls: ChatToolCall[] = [];
  for (const item of raw) {
    const row = item as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const name = row.function?.name;
    if (typeof name !== "string" || !name.trim()) {
      continue;
    }
    const args =
      typeof row.function?.arguments === "string"
        ? row.function.arguments
        : JSON.stringify(row.function?.arguments ?? {});
    calls.push({
      id: typeof row.id === "string" && row.id ? row.id : `call-${calls.length + 1}`,
      name,
      arguments: args,
    });
  }
  return calls;
}

/** Normaliza la respuesta del proveedor activo. */
export function parseChatResponse(provider: ProviderId, payload: unknown): ChatResult {
  return provider === "anthropic"
    ? parseAnthropicResponse(payload)
    : parseOpenAiResponse(payload);
}

/**
 * Envía la conversación al proveedor activo y normaliza la respuesta.
 *
 * `signal` permite cancelar el turno desde la interfaz (botón «Detener»).
 * Los fallos de red se propagan como `Error` con el detalle del proveedor.
 */
/** Une la cancelación del usuario con un plazo fijo. Abortar no se reintenta. */
function linkAbort(
  outer: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("el proveedor no respondió a tiempo", "TimeoutError"));
  }, ms);
  const fromOuter = () => {
    controller.abort(outer?.reason);
  };
  if (outer) {
    if (outer.aborted) {
      fromOuter();
    } else {
      outer.addEventListener("abort", fromOuter);
    }
  }
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", fromOuter);
    },
  };
}

/**
 * Envía el chat con bucle de herramientas (máx. `MAX_TOOL_ROUNDS`).
 * `executeTool` corre en Rust vía IPC; si falta, sólo se limpia markup DSML.
 */
export async function sendChat(
  config: AiConfig,
  messages: ChatMessage[],
  system: string,
  signal?: AbortSignal,
  executeTool?: ToolExecutor,
): Promise<ChatResult> {
  const linked = linkAbort(signal, CHAT_TIMEOUT_MS);
  try {
    let model = config.model;
    let acceptedModel: string | undefined;
    const thread: ToolWireTurn[] = wireMessages(messages).map((message) => ({
      role: message.role,
      text: message.text,
      images: message.images,
    }));
    let usageAcc: ChatUsage | null = null;
    let lastModel = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const result = await exchangeChatRound(
        { ...config, model },
        thread,
        system,
        linked.signal,
        (next) => {
          acceptedModel = next;
          model = next;
        },
      );
      lastModel = result.model || lastModel;
      usageAcc = addUsage(usageAcc, result.usage);

      let toolCalls = result.toolCalls ?? [];
      if (toolCalls.length === 0 && result.text) {
        const leaked = parseToolLeakAsCalls(result.text);
        if (leaked) {
          toolCalls = leaked;
        }
      }

      if (toolCalls.length === 0) {
        const text = sanitizeAssistantText(result.text);
        const renamed =
          acceptedModel ??
          (catalogModelId(model) === model.trim() ? undefined : catalogModelId(model));
        return {
          text,
          model: lastModel,
          usage: usageAcc,
          acceptedModel: renamed,
        };
      }

      if (!executeTool) {
        return {
          text: sanitizeAssistantText(result.text),
          model: lastModel,
          usage: usageAcc,
          acceptedModel,
        };
      }

      thread.push({
        role: "assistant_tools",
        text: result.text,
        toolCalls,
      });
      for (const call of toolCalls) {
        const content = await runToolCall(call, executeTool);
        thread.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content,
        });
      }
    }

    return {
      text: sanitizeAssistantText(
        "el modelo agotó el límite de herramientas en este turno; reformula la pregunta.",
      ),
      model: lastModel,
      usage: usageAcc,
      acceptedModel,
    };
  } finally {
    linked.cancel();
  }
}

function addUsage(left: ChatUsage | null, right: ChatUsage | null): ChatUsage | null {
  if (!left && !right) {
    return null;
  }
  return {
    inputTokens: (left?.inputTokens ?? 0) + (right?.inputTokens ?? 0),
    outputTokens: (left?.outputTokens ?? 0) + (right?.outputTokens ?? 0),
  };
}

/** Una ronda HTTP con reintentos de modelo/transitorio (sin bucle de tools). */
async function exchangeChatRound(
  config: AiConfig,
  thread: ToolWireTurn[],
  system: string,
  signal: AbortSignal,
  onModel: (model: string) => void,
): Promise<ChatResult> {
  let model = config.model;
  for (let attempt = 1; attempt <= CHAT_ATTEMPT_LIMIT; attempt += 1) {
    const request = chatRequest({ ...config, model }, thread, system, true);
    let status = 0;
    let payload: unknown = null;
    try {
      const response = await exchange(
        config.provider,
        request.url,
        "POST",
        String(request.init.body ?? ""),
        signal,
      );
      status = response.status;
      try {
        payload = response.body ? JSON.parse(response.body) : null;
      } catch {
        payload = null;
      }
    } catch (error) {
      if (signal.aborted || attempt >= CHAT_ATTEMPT_LIMIT) {
        throw error;
      }
      continue;
    }
    if (status >= 200 && status < 300) {
      return parseChatResponse(config.provider, payload);
    }
    const detail = extractApiError(status, payload, config.provider);
    const retry = chatRetry(status, detail, model, attempt);
    if (retry?.kind === "model") {
      onModel(retry.model);
      model = retry.model;
      continue;
    }
    if (retry?.kind === "transient") {
      continue;
    }
    throw new Error(detail);
  }
  throw new Error("el proveedor no respondió");
}

/** Lista real de modelos de la cuenta (`GET {base}/models`). La clave la pone el proceso. */
export async function listModels(config: AiConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const base =
    config.provider === "openai"
      ? openAiCompatibleRoot(config.baseUrl)
      : normalizeBaseUrl(config.baseUrl, PROVIDER_ENDPOINTS[config.provider]);
  const response = await exchange(config.provider, `${base}/models`, "GET", undefined, signal);
  let payload: unknown = null;
  try {
    payload = response.body ? JSON.parse(response.body) : null;
  } catch {
    payload = null;
  }
  if (response.status < 200 || response.status >= 300) {
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

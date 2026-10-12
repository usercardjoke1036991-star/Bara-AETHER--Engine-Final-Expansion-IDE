// Autodiagnóstico del panel de IA: comprueba, sin red y sin clave, que el
// contrato con los dos proveedores es el que documentan y que las piezas puras
// (configuración, peticiones, análisis de respuestas, prompt e imágenes) se
// comportan como se espera.
//
// Se ejecuta desde el propio panel (botón «Autodiagnóstico») y también desde
// Node:  npm run test:ai
// En Node no hay `window`, así que no se toca el DOM: la persistencia se prueba
// con un almacén en memoria.

import {
  ANTHROPIC_BROWSER_HEADER,
  ANTHROPIC_VERSION,
  DEFAULT_CONFIG,
  PROVIDER_ENDPOINTS,
  PROVIDER_MODEL_PRESETS,
  STORAGE_KEY,
  configProblems,
  describeConfig,
  forgetConfig,
  loadConfig,
  maskSecret,
  saveConfig,
  withProvider,
  type KeyValueStore,
} from "./config";
import {
  ACCEPTED_TYPES,
  base64Bytes,
  formatBytes,
  splitDataUrl,
  toDataUrl,
} from "./images";
import { baraSystemPrompt, excerpt, inventoryLine, MAX_DOCUMENT_CHARS, rootTable } from "./prompt";
import {
  anthropicRequest,
  chatRequest,
  extractApiError,
  openAiRequest,
  parseAnthropicResponse,
  parseChatResponse,
  parseOpenAiResponse,
  wireMessages,
} from "./providers";
import type { AiConfig, ChatMessage, ImageAttachment } from "./types";

/** Resultado de una comprobación. */
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface Check {
  name: string;
  run: () => string;
}

/** Falla la comprobación con un motivo legible. */
function expect(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Almacén en memoria: misma interfaz que `localStorage`, sin navegador. */
function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** Configuración lista para enviar (clave ficticia). */
function readyConfig(): AiConfig {
  return { ...DEFAULT_CONFIG, apiKey: "sk-prueba-1234567890" };
}

/** Adjunto de mentira con la forma real de una imagen normalizada. */
function fakeImage(): ImageAttachment {
  const base64 = "iVBORw0KGgoAAAANSUhEUg==";
  return {
    id: "adjunto-1",
    name: "captura.png",
    mediaType: "image/png",
    base64,
    dataUrl: toDataUrl("image/png", base64),
    width: 1280,
    height: 720,
    bytes: base64Bytes(base64),
  };
}

/** Mensaje de usuario con una imagen y/o texto. */
function userMessage(text: string, images: ImageAttachment[] = []): ChatMessage {
  return {
    id: `msg-${text.length}-${images.length}`,
    role: "user",
    text,
    images,
    model: "",
    createdAt: 0,
    error: null,
  };
}

/** Respuesta de asistente (posiblemente fallida). */
function assistantMessage(text: string, error: string | null = null): ChatMessage {
  return {
    id: `asistente-${text.length}-${error ?? ""}`,
    role: "assistant",
    text,
    images: [],
    model: "modelo-de-prueba",
    createdAt: 0,
    error,
  };
}

/** Comprobaciones del panel, en orden de presentación. */
const CHECKS: Check[] = [
  {
    name: "config · valores de fábrica coherentes",
    run: () => {
      const problems = configProblems(readyConfig());
      expect(problems.length === 0, `la configuración base no es válida: ${problems.join(" ")}`);
      expect(DEFAULT_CONFIG.provider === "anthropic", "el proveedor inicial debe ser Anthropic");
      expect(
        configProblems(DEFAULT_CONFIG).length === 1,
        "sin clave debe haber exactamente un problema (la clave)",
      );
      return `fábrica: ${describeConfig(DEFAULT_CONFIG).replace(/clave .*? \(/, "clave oculta (")}`;
    },
  },
  {
    name: "config · la clave sólo se guarda si se pide recordarla",
    run: () => {
      const store = memoryStore();
      const efímera: AiConfig = { ...readyConfig(), rememberKey: false };
      expect(saveConfig(efímera, store), "no se pudo escribir la configuración");
      expect(
        store.getItem(STORAGE_KEY)?.includes(efímera.apiKey) === false,
        "la clave viajó al almacén sin permiso",
      );
      const recordada: AiConfig = { ...readyConfig(), rememberKey: true };
      expect(saveConfig(recordada, store), "no se pudo reescribir la configuración");
      expect(loadConfig(store).apiKey === recordada.apiKey, "no se recuperó la clave recordada");
      expect(forgetConfig(store), "no se pudo olvidar la configuración");
      expect(loadConfig(store).apiKey === "", "la clave sobrevivió al olvido");
      return "efímera no persiste · recordada sí · olvidar la borra";
    },
  },
  {
    name: "config · cambiar de proveedor no hereda la clave",
    run: () => {
      const cambiada = withProvider(readyConfig(), "openai");
      expect(cambiada.apiKey === "", "la clave de Anthropic se filtró a OpenAI");
      expect(cambiada.baseUrl === PROVIDER_ENDPOINTS.openai, "raíz de API incorrecta");
      expect(cambiada.model === PROVIDER_MODEL_PRESETS.openai[0], "modelo por defecto incorrecto");
      return `openai ⇒ ${cambiada.baseUrl} · ${cambiada.model}`;
    },
  },
  {
    name: "config · ni el estado ni el enmascarado revelan la clave",
    run: () => {
      const config = readyConfig();
      const line = describeConfig(config);
      expect(!line.includes(config.apiKey), "la línea de estado contiene la clave");
      const masked = maskSecret(config.apiKey);
      expect(masked.includes("•"), "el enmascarado no oculta el centro");
      expect(!masked.includes(config.apiKey.slice(4, -4)), "el enmascarado deja ver el centro");
      expect(maskSecret("") === "(sin clave)", "sin clave debería decirlo");
      return `${line.replace(config.apiKey.slice(4, -4), "…")} · máscara ${masked}`;
    },
  },
  {
    name: "anthropic · petición multimodal bien formada",
    run: () => {
      const config = readyConfig();
      const image = fakeImage();
      const messages = wireMessages([userMessage("¿Qué ves?", [image])]);
      const request = anthropicRequest(config, messages, "SISTEMA");
      const headers = request.init.headers as Record<string, string>;
      expect(request.url === "https://api.anthropic.com/messages", `URL inesperada: ${request.url}`);
      expect(chatRequest(config, messages, "SISTEMA").url === request.url, "el selector falla");
      expect(headers["x-api-key"] === config.apiKey, "falta la cabecera x-api-key");
      expect(headers["anthropic-version"] === ANTHROPIC_VERSION, "falta la versión de la API");
      expect(headers[ANTHROPIC_BROWSER_HEADER] === "true", "falta la autorización para navegador");
      const body = JSON.parse(String(request.init.body)) as {
        model: string;
        max_tokens: number;
        system?: string;
        messages: {
          role: string;
          content: { type: string; text?: string; source?: { media_type: string; data: string } }[];
        }[];
      };
      expect(body.model === config.model, "el modelo no viaja en el cuerpo");
      expect(body.max_tokens === config.maxTokens, "los tokens máximos no viajan");
      expect(body.system === "SISTEMA", "el contexto del sistema se perdió");
      const content = body.messages[0].content;
      expect(content[0].type === "image", "la imagen debería ir primero");
      expect(content[0].source?.media_type === image.mediaType, "tipo de imagen incorrecto");
      expect(content[0].source?.data === image.base64, "la carga útil base64 no coincide");
      expect(content[1].type === "text" && content[1].text === "¿Qué ves?", "falta el texto");
      return `${request.url} · imagen ${image.mediaType} ${formatBytes(image.bytes)} antes del texto`;
    },
  },
  {
    name: "openai · data URL, texto antes de la imagen y tokens modernos",
    run: () => {
      const config: AiConfig = {
        ...withProvider(readyConfig(), "openai"),
        apiKey: "sk-openai-prueba",
      };
      const image = fakeImage();
      const request = openAiRequest(config, wireMessages([userMessage("Mira esto", [image])]), "SISTEMA");
      const headers = request.init.headers as Record<string, string>;
      expect(
        request.url === "https://api.openai.com/v1/chat/completions",
        `URL inesperada: ${request.url}`,
      );
      expect(headers.authorization === `Bearer ${config.apiKey}`, "falta la autorización Bearer");
      const body = JSON.parse(String(request.init.body)) as {
        max_completion_tokens?: number;
        max_tokens?: number;
        messages: { role: string; content: unknown }[];
      };
      expect(body.max_completion_tokens === config.maxTokens, "debería usar max_completion_tokens");
      expect(body.max_tokens === undefined, "no debería enviar max_tokens a la vez");
      expect(body.messages[0].role === "system", "el contexto del sistema no va primero");
      const parts = body.messages[1].content as {
        type: string;
        text?: string;
        image_url?: { url: string };
      }[];
      expect(Array.isArray(parts) && parts[0].type === "text", "el texto debería preceder");
      expect(parts[1].image_url?.url === image.dataUrl, "la imagen debería viajar como data URL");
      const compatible = openAiRequest(
        { ...config, useMaxCompletionTokens: false },
        wireMessages([userMessage("hola")]),
        "",
      );
      const simple = JSON.parse(String(compatible.init.body)) as {
        max_tokens?: number;
        messages: { content: unknown }[];
      };
      expect(simple.max_tokens === config.maxTokens, "el modo compatible debería usar max_tokens");
      expect(typeof simple.messages[0].content === "string", "el texto puro debería ir como cadena");
      return `${request.url} · ${config.maxTokens} tokens · data URL de ${formatBytes(image.bytes)}`;
    },
  },
  {
    name: "respuestas · texto y consumo normalizados",
    run: () => {
      const claude = parseAnthropicResponse({
        model: "claude-de-prueba",
        content: [{ type: "text", text: "primero" }, { type: "text", text: "segundo" }],
        usage: { input_tokens: 120, output_tokens: 42 },
      });
      expect(claude.text === "primero\nsegundo", `texto inesperado: ${claude.text}`);
      expect(claude.usage?.inputTokens === 120, "consumo de entrada mal leído");
      expect(claude.usage?.outputTokens === 42, "consumo de salida mal leído");
      const openai = parseChatResponse("openai", {
        model: "gpt-de-prueba",
        choices: [{ message: { content: "hola" } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      });
      expect(openai.text === "hola", "no se leyó el texto de OpenAI");
      expect(openai.usage?.outputTokens === 3, "consumo de OpenAI mal leído");
      const partes = parseOpenAiResponse({
        choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }],
      });
      expect(partes.text === "a\nb", "no se concatenaron las partes de texto");
      let fallo = "";
      try {
        parseAnthropicResponse({ content: [] });
      } catch (error) {
        fallo = error instanceof Error ? error.message : String(error);
      }
      expect(fallo.includes("no devolvió texto"), "una respuesta vacía debería avisar");
      return `anthropic ${claude.usage?.inputTokens}/${claude.usage?.outputTokens} tokens · openai «${openai.text}»`;
    },
  },
  {
    name: "errores · detalle del proveedor sin filtrar la clave",
    run: () => {
      const config = readyConfig();
      const mensaje = extractApiError(401, { error: { message: "invalid x-api-key" } }, "anthropic");
      expect(mensaje.includes("401"), `falta el código HTTP: ${mensaje}`);
      expect(mensaje.includes("invalid x-api-key"), `falta el detalle: ${mensaje}`);
      expect(!mensaje.includes(config.apiKey), "el error filtró la clave");
      const red = extractApiError(0, null, "openai");
      expect(red.includes("sin respuesta"), `mensaje pobre: ${red}`);
      return mensaje;
    },
  },
  {
    name: "historial · sin fallos, sin vacíos y acotado",
    run: () => {
      const larga: ChatMessage[] = [];
      for (let index = 0; index < 20; index += 1) {
        larga.push(
          index % 2 === 0
            ? userMessage(`pregunta ${index}`)
            : assistantMessage(`respuesta ${index}`),
        );
      }
      expect(wireMessages(larga).length === 12, "el historial debería recortarse a 12 turnos");
      const conFallo = wireMessages([
        userMessage("una"),
        assistantMessage("", "boom"),
        userMessage("dos"),
      ]);
      expect(conFallo.length === 2, "el turno fallido debería descartarse");
      expect(conFallo[1].text === "dos", "se descartó el turno equivocado");
      expect(wireMessages([assistantMessage("")]).length === 0, "un mensaje vacío no debería viajar");
      return `${wireMessages(larga).length} de ${larga.length} turnos viajan`;
    },
  },
  {
    name: "prompt · inyecta catálogo, análisis y ejemplo del kernel",
    run: () => {
      const catalogue = [
        { glyph: "ברא", meaning: "manifestar" },
        { glyph: "עבד", meaning: "ejecutar" },
      ];
      const analysis = {
        sourceChars: 12,
        sourceLines: 1,
        tokens: [],
        summary: {
          total: 3,
          rootsKnown: 2,
          rootsUnknown: 1,
          identifiers: 0,
          numbers: 0,
          strings: 0,
          punctuation: 0,
          newlines: 0,
          eof: 1,
        },
        roots: [{ glyph: "ברא", meaning: "manifestar", count: 2 }],
      };
      const prompt = baraSystemPrompt({
        catalogue,
        sample: "ברא שמר",
        documentName: "genesis.bara",
        documentSource: "ברא ".repeat(2000),
        analysis,
      });
      for (const entry of catalogue) {
        expect(prompt.includes(entry.glyph), `falta la raíz ${entry.glyph} en el prompt`);
      }
      expect(prompt.includes(rootTable(catalogue)), "la tabla de raíces no se inyectó");
      expect(prompt.includes(inventoryLine(analysis)), "el análisis del kernel no se inyectó");
      expect(prompt.includes("inventario: ברא ×2"), "falta el inventario medido por el kernel");
      expect(prompt.includes("genesis.bara"), "falta el nombre del documento abierto");
      expect(prompt.includes("ברא שמר"), "falta el documento de ejemplo del kernel");
      expect(prompt.includes("autopoiesis") && prompt.includes("Belnap"), "faltan los principios");
      const extracto = excerpt("x".repeat(MAX_DOCUMENT_CHARS + 50));
      expect(extracto.includes("extracto recortado"), "el extracto no se acota");
      expect([...extracto].length < MAX_DOCUMENT_CHARS + 200, "el extracto supera el límite");
      return `${prompt.length} caracteres · ${catalogue.length} raíces del kernel inyectadas`;
    },
  },
  {
    name: "imágenes · data URL, tamaño y tipos admitidos",
    run: () => {
      const image = fakeImage();
      const split = splitDataUrl(image.dataUrl);
      expect(split.mediaType === image.mediaType, "el tipo MIME se perdió al partir");
      expect(split.base64 === image.base64, "la carga útil se corrompió al partir");
      expect(toDataUrl(split.mediaType, split.base64) === image.dataUrl, "la data URL no recompone");
      expect(base64Bytes(image.base64) === image.bytes, "el cálculo de bytes no cuadra");
      expect(formatBytes(18) === "18 B", `tamaño en bytes ilegible: ${formatBytes(18)}`);
      expect(formatBytes(2048) === "2 KB", `tamaño en KB ilegible: ${formatBytes(2048)}`);
      expect(
        formatBytes(5 * 1024 * 1024) === "5.0 MB",
        `tamaño en MB ilegible: ${formatBytes(5 * 1024 * 1024)}`,
      );
      expect(ACCEPTED_TYPES.includes("image/png"), "el PNG debería admitirse");
      expect(!ACCEPTED_TYPES.includes("image/svg+xml"), "el SVG no lo aceptan los proveedores");
      return `${image.mediaType} · ${image.width}×${image.height} · ${formatBytes(image.bytes)}`;
    },
  },
  // (fin de las comprobaciones registradas)
];

/** Ejecuta todas las comprobaciones y devuelve el informe (nunca lanza). */
export function runSelfCheck(): CheckResult[] {
  return CHECKS.map((check) => {
    try {
      return { name: check.name, ok: true, detail: check.run() };
    } catch (error) {
      return {
        name: check.name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/** Recuento del informe. */
export function summarize(results: CheckResult[]): {
  passed: number;
  failed: number;
  total: number;
} {
  const failed = results.filter((result) => !result.ok).length;
  return { passed: results.length - failed, failed, total: results.length };
}

/** Informe en texto plano: sirve igual en el panel y en la consola. */
export function formatReport(results: CheckResult[]): string {
  const { passed, total } = summarize(results);
  const lines = [`${passed}/${total} comprobaciones correctas`];
  for (const result of results) {
    lines.push(`${result.ok ? "✔" : "✘"} ${result.name} — ${result.detail}`);
  }
  return lines.join("\n");
}

// Contrato de datos del panel de IA. Tipos puros: este módulo no toca el DOM,
// ni el IPC del kernel, ni la red, de modo que puede comprobarse en Node.

/** Proveedores soportados por el cliente de chat. */
export type ProviderId = "anthropic" | "openai";

/** Rol de un mensaje dentro de la conversación. */
export type ChatRole = "user" | "assistant";

/** Imagen adjunta ya normalizada (data URL + carga útil base64). */
export interface ImageAttachment {
  /** Identificador local (clave de React y de la lista de adjuntos). */
  id: string;
  /** Nombre original del archivo o `pegado-<n>`. */
  name: string;
  /** Tipo MIME real de la imagen (`image/png`, `image/jpeg`…). */
  mediaType: string;
  /** Carga útil base64 **sin** el prefijo `data:`. */
  base64: string;
  /** Data URL completa, la forma que consume OpenAI. */
  dataUrl: string;
  width: number;
  height: number;
  /** Peso aproximado de la carga útil en bytes. */
  bytes: number;
}

/** Mensaje de la conversación tal como lo ve y lo pinta la interfaz. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  images: ImageAttachment[];
  /** Modelo que produjo la respuesta (cadena vacía en los mensajes de usuario). */
  model: string;
  createdAt: number;
  /** Error del proveedor, si el turno falló. */
  error: string | null;
}

/**
 * Configuración del cliente de IA.
 *
 * La clave del usuario **nunca** sale de este equipo salvo en la cabecera de la
 * petición al proveedor que el propio usuario haya elegido.
 */
export interface AiConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  /** Raíz de la API: permite proxies, pasarelas o servidores locales. */
  baseUrl: string;
  maxTokens: number;
  /** `null` = no enviar el parámetro (deja el valor del proveedor). */
  temperature: number | null;
  /** OpenAI: enviar `max_completion_tokens` en lugar de `max_tokens`. */
  useMaxCompletionTokens: boolean;
  /** Persistir la clave en el navegador; si no, sólo vive en esta sesión. */
  rememberKey: boolean;
}

/** Consumo de tokens reportado por el proveedor. */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Respuesta normalizada de cualquiera de los dos proveedores. */
export interface ChatResult {
  text: string;
  model: string;
  usage: ChatUsage | null;
  /** Nombre que el servidor aceptó, si no era el que estaba escrito en ajustes. */
  acceptedModel?: string;
}

/** Modelo ofrecido por el proveedor (`GET /models`). */
export interface ModelInfo {
  id: string;
  label: string;
}

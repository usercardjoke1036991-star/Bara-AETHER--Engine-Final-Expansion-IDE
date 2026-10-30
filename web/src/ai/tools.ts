// Herramientas del asistente: esquema nativo (OpenAI tools) y salvaguarda DSML.
//
// La ejecución real vive en Rust (`workspace_read_project_file`). Este módulo
// sólo describe el contrato, parsea `tool_calls` / fugas de markup y limpia el
// texto que ve el usuario.

/** Nombre estable de la herramienta de lectura (API / tool_calls). */
export const READ_FILE_TOOL = "leer_archivo";

/** Tope de vueltas modelo ↔ herramienta por turno de chat. */
export const MAX_TOOL_ROUNDS = 5;

/** Mensaje cuando el modelo inventó markup y no se pudo ejecutar. */
export const TOOL_LEAK_NOTICE =
  "el modelo intentó usar una herramienta y falló";

/** Una llamada a herramienta ya normalizada. */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON crudo de argumentos (OpenAI). */
  arguments: string;
}

/** Esquema OpenAI `tools` para chat/completions. */
export function openAiTools(): Record<string, unknown>[] {
  return [
    {
      type: "function",
      function: {
        name: READ_FILE_TOOL,
        description:
          "Lee un archivo de texto del proyecto abierto (jaula del workspace; sin ../). Solo lectura.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Ruta relativa al workspace (p. ej. hello.bara o samples/uno.bara).",
            },
          },
          required: ["path"],
        },
      },
    },
  ];
}

/** Esquema Anthropic `tools`. */
export function anthropicTools(): Record<string, unknown>[] {
  return [
    {
      name: READ_FILE_TOOL,
      description:
        "Lee un archivo de texto del proyecto abierto (jaula del workspace; sin ../). Solo lectura.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Ruta relativa al workspace (p. ej. hello.bara).",
          },
        },
        required: ["path"],
      },
    },
  ];
}

/** Extrae `path` del JSON de argumentos o de un objeto ya parseado. */
export function pathFromToolArgs(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as { path?: unknown; file?: unknown };
    if (typeof parsed.path === "string" && parsed.path.trim()) {
      return parsed.path.trim();
    }
    if (typeof parsed.file === "string" && parsed.file.trim()) {
      return parsed.file.trim();
    }
  } catch {
    /* cae al patrón libre */
  }
  const match = trimmed.match(/["']?path["']?\s*[:=]\s*["']([^"']+)["']/i);
  return match?.[1]?.trim() || null;
}

/** ¿El texto parece markup de herramienta (DSML, tool_call, …) y no prosa útil? */
export function looksLikeToolLeak(text: string): boolean {
  const sample = text.slice(0, 4000);
  return (
    /DSML/i.test(sample) ||
    /<\/?tool_call\b/i.test(sample) ||
    /<\/?function[_ ]?call\b/i.test(sample) ||
    /invoke\s+name\s*=/i.test(sample) ||
    /\|DSML\|/i.test(sample)
  );
}

/**
 * Intenta recuperar una llamada «leer archivo» desde markup DSML / XML en texto.
 * Devuelve `null` si no hay una ruta usable.
 */
export function parseToolLeakAsCalls(text: string): ToolCall[] | null {
  if (!looksLikeToolLeak(text)) {
    return null;
  }
  const calls: ToolCall[] = [];

  // DSML / markup DeepSeek: invoke name="leer archivo" … path … hello.bara
  const invokeRe =
    /invoke\s+name\s*=\s*["']([^"']+)["']([\s\S]*?)(?:\/\s*invoke|<\/|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = invokeRe.exec(text)) !== null) {
    const rawName = match[1].trim().toLowerCase().replace(/\s+/g, "_");
    const body = match[2] ?? "";
    const path =
      pathFromParameterBlock(body) ||
      body.match(/\b([\w./\\-]+\.bara)\b/i)?.[1] ||
      null;
    if (path && isReadToolName(rawName)) {
      calls.push({
        id: `leak-${calls.length + 1}`,
        name: READ_FILE_TOOL,
        arguments: JSON.stringify({ path }),
      });
    }
  }

  // <tool_call>…</tool_call> o function_call con path
  const xmlRe =
    /<(?:tool_call|function_call|function)\b[^>]*>([\s\S]*?)<\/(?:tool_call|function_call|function)>/gi;
  while ((match = xmlRe.exec(text)) !== null) {
    const body = match[1] ?? "";
    const nameMatch = body.match(/name\s*[:=]\s*["']?([^\s"']+)/i);
    const rawName = (nameMatch?.[1] ?? READ_FILE_TOOL).toLowerCase().replace(/\s+/g, "_");
    const path =
      pathFromParameterBlock(body) ||
      body.match(/\b([\w./\\-]+\.bara)\b/i)?.[1] ||
      pathFromToolArgs(body);
    if (path && isReadToolName(rawName)) {
      calls.push({
        id: `leak-xml-${calls.length + 1}`,
        name: READ_FILE_TOOL,
        arguments: JSON.stringify({ path }),
      });
    }
  }

  // Último recurso: «leer archivo» + ruta .bara en el mismo bloque con DSML
  if (calls.length === 0 && /leer[\s_]*archivo/i.test(text)) {
    const path = text.match(/\b([\w./\\-]+\.bara)\b/i)?.[1];
    if (path) {
      calls.push({
        id: "leak-fallback-1",
        name: READ_FILE_TOOL,
        arguments: JSON.stringify({ path }),
      });
    }
  }

  return calls.length > 0 ? calls : null;
}

function pathFromParameterBlock(body: string): string | null {
  const named = body.match(
    /parameter\s+name\s*=\s*["']path["'][^>]*>([^<]+)/i,
  );
  if (named?.[1]?.trim()) {
    return named[1].trim();
  }
  const json = pathFromToolArgs(body);
  if (json) {
    return json;
  }
  return null;
}

function isReadToolName(name: string): boolean {
  const n = name.replace(/[\s-]+/g, "_");
  return (
    n === READ_FILE_TOOL ||
    n === "leer_archivo" ||
    n === "read_file" ||
    n === "read_project_file" ||
    (n.includes("leer") && n.includes("archivo"))
  );
}

/**
 * El usuario nunca debe ver markup DSML / tool_call. Si el bucle de tools
 * pudo recuperar la llamada, la ejecuta aparte; aquí sólo se oculta el crudo.
 */
export function sanitizeAssistantText(text: string): string {
  if (!text) {
    return text;
  }
  if (!looksLikeToolLeak(text)) {
    return text;
  }
  return TOOL_LEAK_NOTICE;
}

/** Ejecutor que el panel inyecta (IPC Tauri → jaula Rust). */
export type ToolExecutor = (name: string, argsJson: string) => Promise<string>;

/** Ejecuta una llamada conocida; errores legibles, sin filtrar secretos. */
export async function runToolCall(
  call: ToolCall,
  execute: ToolExecutor,
): Promise<string> {
  const name = call.name.trim().toLowerCase().replace(/\s+/g, "_");
  if (!isReadToolName(name) && name !== READ_FILE_TOOL) {
    return `herramienta desconocida: ${call.name}`;
  }
  try {
    return await execute(READ_FILE_TOOL, call.arguments);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

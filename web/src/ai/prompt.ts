// Contexto del sistema que recibe el modelo de IA.
//
// Todo lo que el modelo necesita saber del lenguaje **se inyecta desde el
// kernel**: el catálogo de raíces (`kernel_catalogue`), el documento de ejemplo
// (`sample_genesis`) y el análisis léxico del documento abierto. Este módulo
// no inventa glifos: redacta reglas cortas y un presupuesto de tokens acotado.

import type { Analysis, RootEntry } from "../engine";

/** Extracto máximo del documento abierto (presupuesto bajo para saludos). */
export const MAX_DOCUMENT_CHARS = 800;

/** Extracto del ejemplo del kernel. */
export const MAX_SAMPLE_CHARS = 400;

/** Estimación local de tokens (mezcla hebreo/ASCII): ~3,5 caracteres/token. */
export function estimateTokens(text: string): number {
  const chars = [...text].length;
  return chars === 0 ? 0 : Math.ceil(chars / 3.5);
}

/** Contexto necesario para redactar el prompt del sistema. */
export interface PromptContext {
  /** Raíces conocidas, tal como las sirve el kernel. */
  catalogue: RootEntry[];
  /** Documento de ejemplo del propio kernel. */
  sample: string;
  /** Origen del documento abierto (ruta o `<editor>`). */
  documentName: string;
  /** Fuente del documento abierto. */
  documentSource: string;
  /** Análisis del kernel sobre esa fuente (o `null` si aún no lo hay). */
  analysis: Analysis | null;
  /** Árbol de la carpeta abierta (texto), sin `.git`/`target`/`node_modules`. */
  treeOutline?: string;
  /**
   * Texto del usuario del turno actual. Sirve para omitir documento/ejemplo
   * en saludos cortos y ahorrar tokens.
   */
  userText?: string;
}

/** Recorta un texto por caracteres Unicode, sin partir un par sustituto. */
export function excerpt(source: string, max = MAX_DOCUMENT_CHARS): string {
  const chars = [...source];
  if (chars.length <= max) {
    return source;
  }
  const omitted = chars.length - max;
  return `${chars.slice(0, max).join("")}\n# … extracto recortado (${omitted} caracteres omitidos)`;
}

/** Inventario de raíces medido por el kernel, en una sola línea. */
export function inventoryLine(analysis: Analysis | null): string {
  if (!analysis) {
    return "(sin análisis todavía)";
  }
  const roots =
    analysis.roots.map((root) => `${root.glyph}×${root.count}`).join(", ") || "ninguna";
  const { summary } = analysis;
  return `${summary.total} tok · conocidas ${summary.rootsKnown} · desconocidas ${summary.rootsUnknown} · id ${summary.identifiers} · núm ${summary.numbers} · str ${summary.strings} · signos ${summary.punctuation} · [${roots}]`;
}

/** Tabla compacta: `glifo:sentido · glifo:sentido`. */
export function rootTable(catalogue: RootEntry[]): string {
  if (catalogue.length === 0) {
    return "(catálogo vacío)";
  }
  return catalogue.map((entry) => `${entry.glyph}:${entry.meaning}`).join(" · ");
}

/**
 * Operadores tipados que el lexer del kernel reconoce (BAR `TokenKind`).
 * Cualquier otro símbolo cae en `Punct` y marca «propuesta no verificada».
 */
export const LEXER_OPERATORS = ["+", "*", "!", "!!", "?", ":", ";", ",", "->"] as const;

/** ¿El turno pide mirar código/archivo? Si no, omitimos documento y ejemplo. */
export function needsCodeContext(userText: string | undefined): boolean {
  const text = (userText ?? "").trim();
  if (!text) {
    return true;
  }
  if (text.length <= 24 && /^(hola|hi|hello|hey|buenas|saludos)[!?.…]*$/i.test(text)) {
    return false;
  }
  return /\b(archivo|file|modifica|edita|cambia|lee|leer|código|codigo|\.bara|bloque|función|funcion|patch|diff)\b/i.test(
    text,
  ) || text.length > 80;
}

// ── Secciones del prompt (cortas a propósito) ──────────────────────────────

const IDENTITY_RULES = `Eres el asistente de Bara IDE (kernel AETHER-Ω). Shoresh: raíces de exactamente 3 consonantes hebreas (U+05D0…U+05EA); nikud/geresh se pliegan. Identificadores ASCII, números, cadenas "…". Comentario con # hasta fin de línea.
Operadores del lexer: ${LEXER_OPERATORS.join(" ")}. No inventes otros.`;

const ONTOLOGY_RULES = `Usa sólo raíces del catálogo inyectado. Otra raíz triconsonántica es legal por autopoiesis pero debes etiquetarla «propuesta no verificada» (el IDE no la auto-aplica). Semántica Belnap (⊤ ⊥ ⊕ ∅); no-explosión; memoria holográfica determinista.`;

const CONTRACT_RULES = `1. Responde en el idioma del usuario.
2. Código Bara en bloque \`\`\`bara.
3. Sé breve: programa + 2–3 líneas.
4. No inventes APIs del kernel.
5. Para leer otro archivo del árbol usa la herramienta nativa leer_archivo (nunca inventes markup DSML ni <tool_call> en el texto).
6. El IDE valida cada bloque bara; lo no verificado no se auto-aplica.`;

/** Partes medidas del prompt (caracteres + estimación de tokens). */
export interface PromptBudgetPart {
  name: string;
  chars: number;
  tokensEst: number;
  text: string;
}

/** Desglose del presupuesto antes de unir el prompt. */
export function promptBudgetParts(context: PromptContext): PromptBudgetPart[] {
  const withCode = needsCodeContext(context.userText);
  const tree = summarizeTreeText((context.treeOutline ?? "").trim());
  const catalogue = rootTable(context.catalogue);
  const docName = context.documentName || "(sin nombre)";
  const analysis = inventoryLine(context.analysis);
  const document = withCode
    ? excerpt(context.documentSource || "", MAX_DOCUMENT_CHARS)
    : "";
  const sample = withCode ? excerpt(context.sample || "", MAX_SAMPLE_CHARS) : "";

  const liveHeader = withCode
    ? `## Documento\n${docName} · ${analysis}\n\`\`\`bara\n${document || "(vacío)"}\n\`\`\`\n\n## Árbol (rutas)\n${tree || "(sin carpeta)"}\n\n## Catálogo\n${catalogue}\n\n## Ejemplo kernel\n\`\`\`bara\n${sample || "(omitido)"}\n\`\`\`\n\n## Herramienta\nUsa leer_archivo(path) vía function calling nativo; no escribas DSML ni XML de herramientas.`
    : `## Sesión\nSaludo / chat corto: sin documento ni ejemplo. Catálogo: ${catalogue}\nÁrbol: ${tree || "(sin carpeta)"}\nHerramienta: leer_archivo(path) nativa si hace falta un archivo.`;

  const parts: PromptBudgetPart[] = [
    partOf("sistema.identidad", IDENTITY_RULES),
    partOf("sistema.ontologia", ONTOLOGY_RULES),
    partOf("sistema.contrato", CONTRACT_RULES),
    partOf("catalogo", catalogue),
    partOf("arbol", tree),
    partOf("documento", withCode ? `${docName}\n${analysis}\n${document}` : ""),
    partOf("ejemplo", sample),
    partOf("vivo.resto", liveHeader),
  ];
  return parts;
}

function partOf(name: string, text: string): PromptBudgetPart {
  return { name, chars: [...text].length, tokensEst: estimateTokens(text), text };
}

/** Resumen numérico del presupuesto (suma de partes lógicas, sin doble conteo del vivo). */
export function summarizeBudget(parts: PromptBudgetPart[]): {
  totalChars: number;
  totalTokensEst: number;
  byName: Record<string, { chars: number; tokensEst: number }>;
} {
  const core = parts.filter((p) =>
    ["sistema.identidad", "sistema.ontologia", "sistema.contrato", "vivo.resto"].includes(
      p.name,
    ),
  );
  const byName: Record<string, { chars: number; tokensEst: number }> = {};
  for (const p of parts) {
    byName[p.name] = { chars: p.chars, tokensEst: p.tokensEst };
  }
  const totalChars = core.reduce((n, p) => n + p.chars, 0);
  const totalTokensEst = core.reduce((n, p) => n + p.tokensEst, 0);
  return { totalChars, totalTokensEst, byName };
}

/**
 * Árbol ya outlineado: deja solo rutas, limita líneas.
 * (La profundidad se controla al generar el outline en `outlineTree`.)
 */
export function summarizeTreeText(tree: string, maxLines = 80): string {
  if (!tree) {
    return "";
  }
  const lines = tree
    .split("\n")
    .map((line) => line.replace(/^[📁·\s]+/, "").trim())
    .filter(Boolean);
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  return `${lines.slice(0, maxLines).join("\n")}\n… (+${lines.length - maxLines} rutas)`;
}

/** Contexto vivo compacto. */
export function liveContext(context: PromptContext): string {
  const withCode = needsCodeContext(context.userText);
  const tree = summarizeTreeText(
    (context.treeOutline ?? "").trim(),
    withCode ? 80 : 20,
  );
  const catalogue = rootTable(context.catalogue);
  if (!withCode) {
    return `## Sesión
Saludo / chat corto: sin documento ni ejemplo para ahorrar contexto.
Catálogo: ${catalogue}
Árbol (muestra): ${tree || "(sin carpeta)"}
Herramienta: leer_archivo(path) por function calling nativo (nunca markup DSML).`;
  }
  return `## Documento
${context.documentName || "(sin nombre)"} · ${inventoryLine(context.analysis)}
\`\`\`bara
${excerpt(context.documentSource) || "(vacío)"}
\`\`\`

## Árbol (rutas)
${tree || "(sin carpeta)"}

## Catálogo
${catalogue}

## Ejemplo kernel
\`\`\`bara
${excerpt(context.sample, MAX_SAMPLE_CHARS)}
\`\`\`

## Herramienta
Usa leer_archivo(path) vía function calling nativo; no escribas DSML ni XML de herramientas en el chat.`;
}

/** Prompt del sistema completo. */
export function baraSystemPrompt(context: PromptContext): string {
  return [IDENTITY_RULES, ONTOLOGY_RULES, CONTRACT_RULES, liveContext(context)].join("\n\n");
}

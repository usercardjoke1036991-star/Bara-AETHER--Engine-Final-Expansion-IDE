// Renderizador de las respuestas del modelo.
//
// Se evita `dangerouslySetInnerHTML` por completo: el texto se parte en prosa y
// bloques de código cercados (```), y cada bloque de código se ofrece al editor
// con un botón. Es un subconjunto deliberadamente pequeño de Markdown —lo que
// el contrato de respuesta pide al modelo— para no añadir dependencias ni
// superficie de inyección.

import { useEffect, useState, type ReactNode } from "react";

import { writeClipboard } from "../clipboard";

/** Fragmento de una respuesta: prosa o bloque cercado. */
export interface Block {
  kind: "text" | "code";
  /** Lenguaje declarado tras las tres comillas invertidas (p. ej. `bara`). */
  language: string;
  content: string;
}

/** Abre o cierra un bloque cercado (``` o ```bara). */
const FENCE = /^\s*```([A-Za-z0-9_+-]*)\s*$/;

/** Parte una respuesta en prosa y bloques de código. */
export function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let fence: { language: string; lines: string[] } | null = null;

  for (const line of markdown.split("\n")) {
    const marker = FENCE.exec(line);
    if (fence) {
      if (marker) {
        blocks.push({ kind: "code", language: fence.language, content: fence.lines.join("\n") });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (marker) {
      if (buffer.length > 0) {
        blocks.push({ kind: "text", language: "", content: buffer.join("\n") });
        buffer = [];
      }
      fence = { language: marker[1] ?? "", lines: [] };
      continue;
    }
    buffer.push(line);
  }

  if (fence) {
    blocks.push({ kind: "code", language: fence.language, content: fence.lines.join("\n") });
  }
  if (buffer.length > 0) {
    blocks.push({ kind: "text", language: "", content: buffer.join("\n") });
  }
  return blocks.filter((block) => block.kind === "code" || block.content.trim().length > 0);
}

/** Todos los bloques de código de una respuesta, en orden. */
export function codeBlocks(markdown: string): string[] {
  return splitBlocks(markdown)
    .filter((block) => block.kind === "code")
    .map((block) => block.content.trim())
    .filter((code) => code.length > 0);
}

/** Convierte `código en línea` en elementos, sin interpretar nada más. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(`[^`]*`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code className="inline-code" key={`inline-${index}`}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`texto-${index}`}>{part}</span>;
  });
}

/** Botón Copiar con feedback «Copiado ✓» durante 2 s. */
function CopyButton({
  label,
  text,
  className,
}: {
  label: string;
  text: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={className}
      title={copied ? "Copiado" : label}
      aria-label={copied ? "Copiado" : label}
      onClick={() => {
        void writeClipboard(text).then((ok) => {
          if (ok) {
            setCopied(true);
          }
        });
      }}
    >
      {copied ? "Copiado ✓" : (
        <>
          <span aria-hidden="true">⧉ </span>
          {label}
        </>
      )}
    </button>
  );
}

/** Bloque de código con acciones: copiar y enviar al editor Shoresh. */
function CodeBlock({ block, onUseCode }: { block: Block; onUseCode?: (code: string) => void }) {
  return (
    <div className="ai-code">
      <div className="ai-code-head">
        <span className="muted">{block.language || "texto"}</span>
        <span className="grow" />
        <CopyButton className="ai-copy-code" label="Copiar" text={block.content} />
        {onUseCode ? (
          <button type="button" onClick={() => onUseCode(block.content)}>
            usar en el editor
          </button>
        ) : null}
      </div>
      <pre className="ai-code-body">{block.content}</pre>
    </div>
  );
}

/** Respuesta del asistente: prosa, bloques y botón Copiar de la respuesta. */
export default function AssistantText({
  text,
  onUseCode,
}: {
  text: string;
  onUseCode?: (code: string) => void;
}) {
  const blocks = splitBlocks(text);
  if (blocks.length === 0) {
    return <p className="muted">Sin respuesta.</p>;
  }

  return (
    <div className="ai-answer">
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <CodeBlock block={block} key={`bloque-${index}`} onUseCode={onUseCode} />
        ) : (
          <p className="ai-text" key={`prosa-${index}`}>
            {renderInline(block.content)}
          </p>
        ),
      )}
      <div className="ai-answer-actions">
        <CopyButton label="Copiar" text={text} />
      </div>
    </div>
  );
}

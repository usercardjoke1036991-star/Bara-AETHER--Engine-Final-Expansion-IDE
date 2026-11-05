// A7 — problemas del análisis del kernel → lista clicable.

import type { Analysis, TokenInfo } from "./engine";

export interface EditorProblem {
  id: string;
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
}

/** Detecta una cadena `"` abierta sin cierre (ignorando comentarios #). */
export function unclosedString(source: string): { line: number; column: number } | null {
  let inString = false;
  let escape = false;
  let line = 1;
  let column = 1;
  let startLine = 1;
  let startCol = 1;
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index];
    if (!inString && ch === "#") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      if (index < source.length && source[index] === "\n") {
        line += 1;
        column = 1;
      }
      continue;
    }
    if (ch === "\n") {
      line += 1;
      column = 1;
      escape = false;
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      startLine = line;
      startCol = column;
    }
    column += 1;
  }
  return inString ? { line: startLine, column: startCol } : null;
}

/** Deriva avisos B9/A7 desde el análisis + un pase local de cadenas. */
export function problemsFromAnalysis(
  analysis: Analysis | null,
  path: string,
  source: string,
): EditorProblem[] {
  const problems: EditorProblem[] = [];
  if (!path) {
    return problems;
  }
  if (analysis) {
    const seen = new Set<string>();
    for (const token of analysis.tokens) {
      const hit = problemFromToken(token, path);
      if (!hit) {
        continue;
      }
      const key = `${hit.line}:${hit.column}:${hit.message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      problems.push(hit);
    }
  }
  const open = unclosedString(source);
  if (open) {
    problems.push({
      id: `str-${open.line}-${open.column}`,
      path,
      line: open.line,
      column: open.column,
      severity: "error",
      message: "cadena sin cerrar",
    });
  }
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

function problemFromToken(token: TokenInfo, path: string): EditorProblem | null {
  if (token.class === "rootUnknown") {
    return {
      id: `ru-${token.line}-${token.column}-${token.lexeme}`,
      path,
      line: token.line,
      column: token.column,
      severity: "warning",
      message: `raíz desconocida «${token.display || token.lexeme}»`,
    };
  }
  if (token.class === "identifier") {
    return {
      id: `id-${token.line}-${token.column}-${token.lexeme}`,
      path,
      line: token.line,
      column: token.column,
      severity: "warning",
      message: `identificador sin raíz «${token.lexeme}»`,
    };
  }
  return null;
}

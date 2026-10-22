// Modo léxico de `.bara` para CodeMirror.
//
// Replica las clases que el kernel ya distingue (raíz conocida, raíz
// desconocida, operador paraconsistente, meta-comando, cadena, número,
// identificador y comentario). No ejecuta el programa: el análisis
// autoritativo sigue siendo `analyze_source`.

import { StreamLanguage, type StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** Las seis raíces con semántica fija en `bara::lexer::Keyword`. */
const KNOWN_ROOTS = new Set(["ברא", "שמר", "חכם", "עבד", "אמר", "שפט"]);

const HEBREW = /[\u05D0-\u05EA]/;
const NIKUD = /[\u0591-\u05C7]/;
const IDENT = /[A-Za-z_\u00C0-\u024F]/;
const IDENT_REST = /[A-Za-z0-9_\u00C0-\u024F-]/;

function eatString(stream: StringStream): void {
  while (!stream.eol()) {
    const char = stream.next();
    if (char === "\\") {
      stream.next();
    } else if (char === '"') {
      break;
    }
  }
}

function token(stream: StringStream): string | null {
  if (stream.eatSpace()) {
    return null;
  }
  if (stream.match("#")) {
    stream.skipToEnd();
    return "comment";
  }
  if (stream.match("!!")) {
    return "operator";
  }
  const head = stream.peek();
  if (head === "!" || head === "?" || head === "*" || head === "+") {
    stream.next();
    return "operator";
  }
  if (head === ":") {
    stream.next();
    stream.eatWhile(IDENT_REST);
    return "meta";
  }
  if (head === '"') {
    stream.next();
    eatString(stream);
    return "string";
  }
  if (stream.match(/^-?\d+(?:\.\d+)?/)) {
    return "number";
  }
  if (head !== undefined && HEBREW.test(head)) {
    let root = "";
    while (root.length < 3) {
      const next = stream.peek();
      if (next === undefined || !HEBREW.test(next)) {
        break;
      }
      root += stream.next();
    }
    return root.length === 3 && KNOWN_ROOTS.has(root) ? "keyword" : "atom";
  }
  if (head !== undefined && NIKUD.test(head)) {
    stream.next();
    return null;
  }
  if (head !== undefined && IDENT.test(head)) {
    stream.next();
    stream.eatWhile(IDENT_REST);
    return "variableName";
  }
  stream.next();
  return null;
}

/** Lenguaje de flujo del editor: raíces, operadores de Belnap y meta-comandos. */
export const baraLanguage = StreamLanguage.define({
  token,
  tokenTable: {
    comment: tags.comment,
    operator: tags.operator,
    meta: tags.meta,
    string: tags.string,
    number: tags.number,
    keyword: tags.keyword,
    atom: tags.atom,
    variableName: tags.variableName,
  },
});

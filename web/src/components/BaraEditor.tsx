import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

import { baraLanguage } from "../bara-mode";
import { localCompletions } from "../completion";

const baraHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#4fd1c5" },
  { tag: tags.atom, color: "#e07a5f" },
  { tag: tags.operator, color: "#f0b429" },
  { tag: tags.meta, color: "#f0b429" },
  { tag: tags.comment, color: "#7f8ea3", fontStyle: "italic" },
  { tag: tags.string, color: "#9ecbff" },
  { tag: tags.number, color: "#d7e3f0" },
  { tag: tags.variableName, color: "#9ecbff" },
]);

const baraTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "#d7e3f0",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily: "Consolas, 'Segoe UI Mono', monospace",
    lineHeight: "1.45",
  },
  ".cm-content": { caretColor: "#f0b429", padding: "0.35rem 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#f0b429" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "#7f8ea3",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "rgba(240, 180, 41, 0.06)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
});

/** Texto fantasma anclado al cursor. No forma parte del documento. */
class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ghost";
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }

  eq(other: GhostWidget): boolean {
    return this.text === other.text;
  }
}

interface Ghost {
  pos: number;
  fullSuffix: string;
  partialSuffix: string;
}

const setGhost = StateEffect.define<Ghost | null>();

const ghostField = StateField.define<Ghost | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setGhost)) {
        return effect.value;
      }
    }
    if (transaction.docChanged || transaction.selection !== undefined) {
      return null;
    }
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field, (ghost) => {
      if (ghost === null || ghost.fullSuffix.length === 0) {
        return Decoration.none;
      }
      const widget = Decoration.widget({
        widget: new GhostWidget(ghost.fullSuffix),
        side: 1,
      });
      return Decoration.set([widget.range(ghost.pos)]);
    });
  },
});

const TOKEN = /[\p{L}\p{N}_]+$/u;
const TOKEN_START = /^[\p{L}\p{N}_]/u;

function remainder(prefix: string, suggestion: string): string {
  return suggestion.startsWith(prefix) ? suggestion.slice(prefix.length) : suggestion;
}

function tokenAtCursor(view: EditorView): { prefix: string; line: number; pos: number } | null {
  const range = view.state.selection.main;
  if (!range.empty) {
    return null;
  }
  const pos = range.head;
  const line = view.state.doc.lineAt(pos);
  const after = line.text.slice(pos - line.from);
  if (TOKEN_START.test(after)) {
    return null;
  }
  const before = line.text.slice(0, pos - line.from);
  const match = TOKEN.exec(before);
  return { prefix: match?.[0] ?? "", line: line.number, pos };
}

function acceptGhost(view: EditorView, mode: "full" | "partial"): boolean {
  const ghost = view.state.field(ghostField, false);
  if (ghost == null) {
    return false;
  }
  const insert = mode === "full" ? ghost.fullSuffix : ghost.partialSuffix;
  if (insert.length === 0) {
    return false;
  }
  view.dispatch({
    changes: { from: ghost.pos, insert },
    selection: { anchor: ghost.pos + insert.length },
    effects: setGhost.of(null),
  });
  return true;
}

function dismissGhost(view: EditorView): boolean {
  const ghost = view.state.field(ghostField, false);
  if (ghost == null) {
    return false;
  }
  view.dispatch({ effects: setGhost.of(null) });
  return true;
}

const completionKeys = Prec.highest(
  keymap.of([
    { key: "Tab", run: (view) => acceptGhost(view, "full") },
    { key: "Enter", run: (view) => acceptGhost(view, "partial") },
    { key: "Escape", run: dismissGhost },
  ]),
);

interface BaraEditorProps {
  /** Texto del documento activo. */
  value: string;
  /** Ruta relativa del documento. Vacía si todavía no hay pestaña. */
  path: string;
  /** Línea 1-based que el grafo pide mostrar. */
  revealLine: number | null;
  /** Cambia cuando llega otra petición, aunque la línea sea la misma. */
  revealToken: number;
  /** El padre guarda el texto en la pestaña y lo reanaliza. */
  onChange: (next: string) => void;
  /** Línea 1-based del cursor, para insertar un parche en ese sitio. */
  onCursor?: (line: number) => void;
}

/** Editor CodeMirror del documento `.bara` activo, con texto fantasma local. */
export default function BaraEditor({
  value,
  path,
  revealLine,
  revealToken,
  onChange,
  onCursor,
}: BaraEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  const pathRef = useRef(path);
  const generationRef = useRef(0);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;
  pathRef.current = path;

  useEffect(() => {
    const parent = host.current;
    if (parent === null) {
      return;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (view: EditorView) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      timer = setTimeout(() => {
        void requestGhost(view, generation);
      }, 40);
    };

    const requestGhost = async (view: EditorView, generation: number) => {
      const token = tokenAtCursor(view);
      if (!alive) {
        return;
      }
      if (token === null || token.prefix.length === 0) {
        if (alive && generation === generationRef.current) {
          view.dispatch({ effects: setGhost.of(null) });
        }
        return;
      }
      try {
        const items = await localCompletions(token.line, token.prefix, pathRef.current);
        if (!alive || generation !== generationRef.current) {
          return;
        }
        const best = items[0];
        const current = tokenAtCursor(view);
        if (best === undefined || current === null || current.pos !== token.pos) {
          view.dispatch({ effects: setGhost.of(null) });
          return;
        }
        const fullSuffix = remainder(current.prefix, best.text);
        const partialSuffix = remainder(current.prefix, best.partial);
        if (fullSuffix.length === 0) {
          view.dispatch({ effects: setGhost.of(null) });
          return;
        }
        view.dispatch({
          effects: setGhost.of({ pos: current.pos, fullSuffix, partialSuffix }),
        });
      } catch {
        if (alive && generation === generationRef.current) {
          view.dispatch({ effects: setGhost.of(null) });
        }
      }
    };

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          completionKeys,
          ghostField,
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          baraLanguage,
          syntaxHighlighting(baraHighlight),
          baraTheme,
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const line = update.state.doc.lineAt(update.state.selection.main.head).number;
              onCursorRef.current?.(line);
            }
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
              schedule(update.view);
            } else if (update.selectionSet) {
              schedule(update.view);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      alive = false;
      if (timer !== null) {
        clearTimeout(timer);
      }
      view.destroy();
      viewRef.current = null;
    };
    // El documento inicial entra en el estado; los cambios posteriores
    // llegan por el efecto de sincronización.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }
    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || revealLine === null || revealLine < 1) {
      return;
    }
    const lineNo = Math.min(revealLine, view.state.doc.lines);
    const line = view.state.doc.line(lineNo);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
  }, [revealLine, revealToken, value]);

  return <div className="bara-editor" ref={host} aria-label="Editor Shoresh" />;
}

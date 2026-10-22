import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

import { baraLanguage } from "../bara-mode";

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

interface BaraEditorProps {
  /** Texto del documento activo. */
  value: string;
  /** El padre guarda el texto en la pestaña y lo reanaliza. */
  onChange: (next: string) => void;
}

/** Editor CodeMirror del documento `.bara` activo. */
export default function BaraEditor({ value, onChange }: BaraEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const parent = host.current;
    if (parent === null) {
      return;
    }
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          baraLanguage,
          syntaxHighlighting(baraHighlight),
          baraTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
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

  return <div className="bara-editor" ref={host} aria-label="Editor Shoresh" />;
}

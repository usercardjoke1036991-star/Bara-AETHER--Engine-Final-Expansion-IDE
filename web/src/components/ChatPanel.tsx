// Panel lateral del asistente: texto e imágenes, atado al kernel.
//
// Todo lo que el modelo sabe del lenguaje viaja desde el kernel (catálogo de
// raíces, documento de ejemplo, análisis del documento abierto y traducción
// natural→Shoresh por IPC), así que este archivo no contiene un solo glifo de
// Shoresh escrito a mano.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  configProblems,
  defaultStore,
  describeConfig,
  forgetConfig,
  loadConfig,
  saveConfig,
} from "../ai/config";
import { MAX_ATTACHMENTS, filesFromDataTransfer, formatBytes, prepareImages } from "../ai/images";
import { baraSystemPrompt } from "../ai/prompt";
import { listModels, sendChat } from "../ai/providers";
import { formatReport, runSelfCheck, summarize } from "../ai/selfcheck";
import type { AiConfig, ChatMessage, ChatUsage, ImageAttachment, ModelInfo } from "../ai/types";
import type { AutoApplyReport } from "../autoApply";
import { loadLocalWeights, localComplete } from "../offline";
import { shoreshTranslate, type Analysis, type RootEntry, type Translation } from "../engine";
import AiSettings from "./AiSettings";
import AssistantText, { codeBlocks } from "./AssistantText";

/** Identificador local de un mensaje (clave de React y de las traducciones). */
function newId(): string {
  return crypto.randomUUID();
}

/** Detalle legible de cualquier fallo. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ChatPanelProps {
  /** Visibilidad del panel (lo gobierna `App`). */
  open: boolean;
  /** Ausente en la ventana dedicada: allí el panel no se cierra. */
  onClose?: () => void;
  /** Origen del documento abierto: ruta del disco o `<editor>`. */
  documentName: string;
  /** Fuente del documento abierto: lo que se inyecta como contexto. */
  documentSource: string;
  analysis: Analysis | null;
  catalogue: RootEntry[];
  /** Documento de ejemplo embebido en el binario del kernel. */
  sample: string;
  /** Envía un bloque de código al editor del IDE. */
  onUseCode: (code: string) => void;
  /** Pide al núcleo el veto de Belnap y, si es `∅`, la escritura. */
  onJudge: (patch: string) => Promise<AutoApplyReport>;
}

export default function ChatPanel({
  open,
  onClose,
  documentName,
  documentSource,
  analysis,
  catalogue,
  sample,
  onUseCode,
  onJudge,
}: ChatPanelProps) {
  const [config, setConfig] = useState<AiConfig>(() => loadConfig());
  const [settings, setSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [usages, setUsages] = useState<Record<string, ChatUsage>>({});
  const [translations, setTranslations] = useState<Record<string, Translation>>({});
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offline, setOffline] = useState(false);
  const [weights, setWeights] = useState<string | null>(null);
  const [autoApply, setAutoApply] = useState(() => {
    try {
      return localStorage.getItem("bara.autoApply") === "1";
    } catch {
      return false;
    }
  });

  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const storeAvailable = useMemo(() => defaultStore() !== null, []);
  const problems = configProblems(config);

  // El contexto del sistema se recalcula sólo cuando cambia el kernel: el
  // prompt que viaja al proveedor es exactamente el que se puede inspeccionar.
  const system = useMemo(
    () => baraSystemPrompt({ catalogue, sample, documentName, documentSource, analysis }),
    [catalogue, sample, documentName, documentSource, analysis],
  );

  useEffect(() => {
    if (open && !settings) {
      draftRef.current?.focus();
    }
  }, [open, settings]);

  useEffect(() => {
    try {
      localStorage.setItem("bara.autoApply", autoApply ? "1" : "0");
    } catch {
      // El almacén puede estar cerrado. El interruptor sigue valiendo en esta sesión.
    }
  }, [autoApply]);

  /** Adjunta archivos (arrastrados, pegados o elegidos) al mensaje en curso. */
  const attach = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      const { attachments: added, errors } = await prepareImages(files, attachments.length);
      if (added.length > 0) {
        setAttachments((previous) => [...previous, ...added]);
      }
      setNotice(errors.length > 0 ? errors.join(" · ") : null);
    },
    [attachments.length],
  );

  /** Envía el turno actual al proveedor elegido. */
  const send = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || pending) {
      return;
    }
    const user: ChatMessage = {
      id: newId(),
      role: "user",
      text,
      images: attachments,
      model: "",
      createdAt: Date.now(),
      error: null,
    };
    const history: ChatMessage[] = [...messages, user];
    setMessages(history);
    setDraft("");
    setAttachments([]);
    setNotice(null);
    setPending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (offline) {
        const local = await localComplete(text);
        setMessages((previous) => [
          ...previous,
          {
            id: newId(),
            role: "assistant",
            text: local.reply,
            images: [],
            model: local.name,
            createdAt: Date.now(),
            error: null,
          },
        ]);
        return;
      }
      const result = await sendChat(config, history, system, controller.signal);
      const id = newId();
      const usage = result.usage;
      setMessages((previous) => [
        ...previous,
        {
          id,
          role: "assistant",
          text: result.text,
          images: [],
          model: result.model,
          createdAt: Date.now(),
          error: null,
        },
      ]);
      if (usage) {
        setUsages((previous) => ({ ...previous, [id]: usage }));
      }
      if (autoApply) {
        const blocks = codeBlocks(result.text);
        for (const block of blocks) {
          try {
            const report = await onJudge(block);
            if (report.status === "both") {
              setNotice(
                `Veto ${report.glyph}: el bloque contradice el archivo. Hace falta intervención manual.`,
              );
              break;
            }
            if (report.applied) {
              setNotice(`Auto-Apply ${report.glyph}: escrito en ${report.path}:${report.line}.`);
            } else {
              setNotice(`Auto-Apply ${report.glyph}: el bloque no se escribió.`);
            }
          } catch (error) {
            setNotice(reasonOf(error));
            break;
          }
        }
      }
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        {
          id: newId(),
          role: "assistant",
          text: "",
          images: [],
          model: config.model,
          createdAt: Date.now(),
          error: reasonOf(error),
        },
      ]);
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }, [attachments, autoApply, config, draft, messages, offline, onJudge, pending, system]);

  /** Cancela el turno en curso (el proveedor corta en cuanto se interrumpe). */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Traduce un texto a Shoresh con el léxico del propio kernel (IPC). */
  const translate = useCallback(async (key: string, text: string) => {
    if (text.trim().length === 0) {
      return;
    }
    try {
      const result = await shoreshTranslate(text);
      setTranslations((previous) => ({ ...previous, [key]: result }));
      setNotice(
        result.synthesized > 0
          ? `El oráculo sintetizó ${result.synthesized} raíz(es) nuevas por autopoiesis.`
          : null,
      );
    } catch (error) {
      setNotice(reasonOf(error));
    }
  }, []);

  /** Persiste los ajustes (la clave sólo si se pidió recordarla). */
  const persist = useCallback(() => {
    const saved = saveConfig(config);
    setNotice(
      saved
        ? "Ajustes guardados."
        : "No se pudo guardar: el almacén del navegador no está disponible.",
    );
  }, [config]);

  /** Vuelve a la configuración de arranque (fábrica + entorno). */
  const forget = useCallback(() => {
    forgetConfig();
    setConfig(loadConfig());
    setModels([]);
    setModelStatus(null);
    setNotice("Ajustes olvidados: se vuelve a los valores de fábrica y del entorno.");
  }, []);

  /** Lista real de modelos de la cuenta (requiere una clave válida). */
  const fetchModels = useCallback(async () => {
    setModelStatus("consultando…");
    try {
      const list = await listModels(config);
      setModels(list);
      setModelStatus(`${list.length} modelos`);
    } catch (error) {
      setModelStatus(null);
      setNotice(reasonOf(error));
    }
  }, [config]);

  /** Autodiagnóstico: las mismas comprobaciones que `npm run test:ai`. */
  const selfCheck = useCallback(() => {
    const results = runSelfCheck();
    const { failed, passed, total } = summarize(results);
    setReport(formatReport(results));
    setNotice(
      failed > 0
        ? `Autodiagnóstico: ${failed} de ${total} comprobaciones con fallos.`
        : `Autodiagnóstico: ${passed}/${total} comprobaciones correctas.`,
    );
  }, []);

  if (!open) {
    return null;
  }

  return (
    <aside
      className={`ai-panel${dragging ? " dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void attach(filesFromDataTransfer(event.dataTransfer));
      }}
    >
      <header className="ai-head">
        <h2>Asistente</h2>
        <button
          type="button"
          className={offline ? "ai-offline-on" : ""}
          aria-pressed={offline}
          onClick={() => setOffline((current) => !current)}
        >
          Offline
        </button>
        <button
          type="button"
          onClick={() => {
            void loadLocalWeights()
              .then((card) => {
                setWeights(`${card.name} · ${card.architecture}`);
                setNotice(null);
              })
              .catch((error: unknown) => setNotice(reasonOf(error)));
          }}
        >
          GGUF
        </button>
        <button
          type="button"
          className={autoApply ? "ai-auto-on" : ""}
          aria-pressed={autoApply}
          onClick={() => setAutoApply((current) => !current)}
        >
          Auto-Apply
        </button>
        <span className="grow" />
        <button type="button" onClick={() => setSettings(!settings)}>
          {settings ? "chat" : "ajustes"}
        </button>
        {onClose ? (
          <button type="button" onClick={onClose}>
            cerrar
          </button>
        ) : null}
      </header>

      {settings ? (
        <div className="ai-body">
          <AiSettings
            config={config}
            models={models}
            status={modelStatus}
            busy={pending}
            storeAvailable={storeAvailable}
            onChange={setConfig}
            onSave={persist}
            onForget={forget}
            onLoadModels={() => {
              void fetchModels();
            }}
            onClose={() => setSettings(false)}
          />
          <details className="ai-report">
            <summary className="muted">prompt del sistema ({system.length} caracteres)</summary>
            <pre className="ai-code-body">{system}</pre>
          </details>
        </div>
      ) : (
        <div className="ai-body">
          <div className="ai-log">
            {messages.length === 0 ? (
              <div className="ai-welcome">
                <p className="muted">
                  Contexto inyectado desde el kernel en cada turno: {catalogue.length} raíces del
                  catálogo, el documento de ejemplo y{" "}
                  {analysis
                    ? `${analysis.summary.total} tokens analizados`
                    : "todavía ningún análisis"}
                  .
                </p>
                <p className="muted">{describeConfig(config)}</p>
                <p className="muted">
                  Offline responde con el núcleo y la cabecera GGUF
                  {weights ? ` (${weights})` : ""}. No abre la red.
                </p>
                <p className="muted">
                  Adjunte capturas con el botón «imagen», arrástrelas al panel o péguelas con
                  Ctrl+V: hasta {MAX_ATTACHMENTS} por mensaje.
                </p>
              </div>
            ) : null}

            {problems.length > 0 ? (
              <ul className="ai-problems">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}

            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                usage={usages[message.id]}
                translation={translations[message.id]}
                onUseCode={onUseCode}
                onTranslate={(id, text) => {
                  void translate(id, text);
                }}
              />
            ))}
            {pending ? <p className="muted">consultando al modelo…</p> : null}
          </div>

          <form
            className="ai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {attachments.length > 0 ? (
              <div className="ai-chips">
                {attachments.map((image) => (
                  <span className="ai-chip" key={image.id}>
                    <img src={image.dataUrl} alt={image.name} />
                    <span className="ai-chip-name">
                      {image.name}
                      <span className="muted"> · {formatBytes(image.bytes)}</span>
                    </span>
                    <button
                      type="button"
                      title="quitar"
                      onClick={() =>
                        setAttachments((previous) =>
                          previous.filter((item) => item.id !== image.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <textarea
              ref={draftRef}
              className="code ai-input"
              rows={3}
              dir="auto"
              spellCheck={false}
              placeholder="Pregunte sobre Shoresh, pegue un fragmento o suelte una imagen…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const files = filesFromDataTransfer(event.clipboardData);
                if (files.length > 0) {
                  event.preventDefault();
                  void attach(files);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />

            <div className="row">
              <button type="submit" disabled={pending || draft.trim().length === 0}>
                Enviar
              </button>
              {pending ? (
                <button type="button" onClick={stop}>
                  Detener
                </button>
              ) : null}
              <label className="ai-attach">
                imagen
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    void attach(files);
                  }}
                />
              </label>
              <span className="grow" />
              <span className="muted">
                {attachments.length}/{MAX_ATTACHMENTS}
              </span>
            </div>

            <div className="row">
              <button
                type="button"
                disabled={draft.trim().length === 0}
                onClick={() => {
                  void translate("borrador", draft);
                }}
              >
                Traducir a Shoresh
              </button>
              <button type="button" onClick={selfCheck}>
                Autodiagnóstico
              </button>
            </div>

            {translations.borrador ? (
              <TranslationBox result={translations.borrador} onUseCode={onUseCode} />
            ) : null}
            {notice ? <p className="muted">{notice}</p> : null}
            {report ? (
              <details className="ai-report">
                <summary className="muted">autodiagnóstico del panel</summary>
                <pre className="ai-code-body">{report}</pre>
              </details>
            ) : null}
          </form>
        </div>
      )}
    </aside>
  );
}

/** Fila de la conversación: texto, miniaturas, uso, error y traducción. */
function MessageRow({
  message,
  usage,
  translation,
  onUseCode,
  onTranslate,
}: {
  message: ChatMessage;
  usage?: ChatUsage;
  translation?: Translation;
  onUseCode: (code: string) => void;
  onTranslate: (id: string, text: string) => void;
}) {
  const mine = message.role === "user";
  const code = mine ? [] : codeBlocks(message.text);
  const hasText = message.text.trim().length > 0;

  return (
    <article className={`ai-msg ${message.role}`}>
      <div className="ai-msg-head">
        <span className="muted">{mine ? "tú" : message.model || "asistente"}</span>
        <span className="grow" />
        {usage ? (
          <span className="muted">
            {usage.inputTokens}→{usage.outputTokens} tokens
          </span>
        ) : null}
        {hasText ? (
          <button
            type="button"
            title="traducir a Shoresh con el léxico del kernel"
            onClick={() => onTranslate(message.id, message.text)}
          >
            Shoresh
          </button>
        ) : null}
        {code.length > 0 ? (
          <button type="button" onClick={() => onUseCode(code.join("\n\n"))}>
            usar {code.length} bloque(s)
          </button>
        ) : null}
      </div>

      {message.images.length > 0 ? (
        <div className="ai-thumbs">
          {message.images.map((image) => (
            <img
              key={image.id}
              src={image.dataUrl}
              alt={image.name}
              title={`${image.name} · ${formatBytes(image.bytes)}`}
            />
          ))}
        </div>
      ) : null}

      {message.error ? <p className="ai-error">{message.error}</p> : null}
      {hasText ? <AssistantText text={message.text} onUseCode={onUseCode} /> : null}
      {translation ? <TranslationBox result={translation} onUseCode={onUseCode} /> : null}
    </article>
  );
}

/** Programa *Shoresh* que devolvió el kernel para un texto dado. */
function TranslationBox({
  result,
  onUseCode,
}: {
  result: Translation;
  onUseCode: (code: string) => void;
}) {
  const roots = result.roots.length > 0 ? `raíces: ${result.roots.join(" ")}` : "sin raíces";
  const extra = result.synthesized > 0 ? ` · ${result.synthesized} sintetizada(s)` : "";

  return (
    <div className="ai-code">
      <div className="ai-code-head">
        <span className="muted">
          Shoresh · {roots}
          {extra}
        </span>
        <span className="grow" />
        {result.program ? (
          <button type="button" onClick={() => onUseCode(result.program)}>
            usar en el editor
          </button>
        ) : null}
      </div>
      <pre className="ai-code-body">{result.program || "(sin programa)"}</pre>
    </div>
  );
}


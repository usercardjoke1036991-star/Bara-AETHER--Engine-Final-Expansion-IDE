// Panel lateral del asistente: texto e imágenes, atado al kernel.
//
// Todo lo que el modelo sabe del lenguaje viaja desde el kernel (catálogo de
// raíces, documento de ejemplo, análisis del documento abierto y traducción
// natural→Shoresh por IPC), así que este archivo no contiene un solo glifo de
// Shoresh escrito a mano.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  chatSendGate,
  configProblems,
  defaultStore,
  describeConfig,
  forgetConfig,
  loadConfig,
  peekStoredSecret,
  providerNeedsKey,
  saveConfig,
  stripStoredSecret,
} from "../ai/config";
import {
  MAX_ATTACHMENTS,
  fileNotesForPrompt,
  filesFromDataTransfer,
  formatBytes,
  isVisionAttachment,
  prepareAttachments,
} from "../ai/images";
import BrandMark from "../shell/BrandMark";
import { writeClipboard } from "../clipboard";
import { baraSystemPrompt, promptBudgetParts, summarizeBudget } from "../ai/prompt";
import { deleteKey, inDesktop, keyExists, probeConnection, saveKey } from "../ai/keyring";
import { listModels, sendChat } from "../ai/providers";
import { MAX_READS_PER_TURN, READ_FILE_TOOL, wrapFileDataPayload } from "../ai/tools";
import { formatReport, runSelfCheck, summarize } from "../ai/selfcheck";
import type { AiConfig, ChatMessage, ChatUsage, ImageAttachment, ModelInfo } from "../ai/types";
import {
  clearChatHistory,
  loadChatHistory,
  saveChatHistory,
} from "../ai/chatHistory";
import { emptyReport, type AutoApplyReport } from "../autoApply";
import { readAutoApplyEnabled, writeAutoApplyEnabled } from "../autoApply";
import { buildReviewChrome, type ReviewChromeLive } from "../reviewChrome";
import { PROPOSE_PATCH_EVENT, proposeEditorPatch, readProjectFile } from "../editorBridge";
import {
  filesFromUnifiedDiff,
  liveMapApplyBatch,
  mergeUnifiedDiff,
  liveMapContext,
  liveMapGate,
  liveMapImpact,
  spliceHost,
  type BatchChange,
} from "../liveMap";
import { loadLocalWeights, localComplete } from "../offline";
import {
  formatPatchDebug,
  preflightPatch,
  resolvePatchAttempt,
  shouldListenForPropose,
} from "../patchFlow";
import {
  armAiTurn,
  cancelAiInFlight,
  interruptKernel,
  shoreshTranslate,
  type Analysis,
  type RootEntry,
  type Translation,
} from "../engine";
import { currentVista, openDeskWindow } from "../windows";
import AiSettings from "./AiSettings";
import AssistantText, { codeBlocks, firstBaraCodeBlock } from "./AssistantText";

/** Identificador local de un mensaje (clave de React y de las traducciones). */
function newId(): string {
  return crypto.randomUUID();
}

/** Detalle legible de cualquier fallo. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Manda el borrador al proceso y lo quita de la interfaz. */
async function commitKey(
  config: AiConfig,
  setConfig: (config: AiConfig) => void,
  bumpEpoch?: () => void,
): Promise<AiConfig> {
  // §9.5.12: local no usa llavero ni clave.
  if (!providerNeedsKey(config.provider)) {
    const next = { ...config, apiKey: "", hasKey: false, rememberKey: false };
    saveConfig(next);
    setConfig(next);
    return next;
  }
  const draft = config.apiKey.trim();
  if (!draft) {
    // Sin borrador: confirma si el proceso ya tiene clave (llavero o sesión).
    const has = inDesktop() ? await keyExists(config.provider) : config.hasKey;
    const next = { ...config, apiKey: "", hasKey: has };
    setConfig(next);
    return next;
  }
  await saveKey(config.provider, draft, config.rememberKey);
  bumpEpoch?.();
  const has = inDesktop() ? await keyExists(config.provider) : true;
  if (!has) {
    throw new Error(
      config.rememberKey
        ? "el llavero no conservó la clave; revisa el Credential Manager"
        : "la sesión del proceso no tiene la clave tras Guardar",
    );
  }
  const next = { ...config, apiKey: "", hasKey: true, rememberKey: config.rememberKey };
  saveConfig(next);
  setConfig(next);
  return next;
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
  /** Árbol de la carpeta abierta, ya formateado para el prompt. */
  treeOutline?: string;
  /**
   * Opcional: pegar código en el editor sin diff (p. ej. Visual Builder).
   * «usar en el editor» del chat **no** usa esto: abre previewDiff.
   */
  onUseCode?: (code: string) => void;
  /** Juzga un bloque sin escribir (diff + canApply). */
  onJudge: (patch: string) => Promise<AutoApplyReport>;
  /** Escribe tras aceptar el diff (con respaldo). */
  onConfirm: (patch: string, judgmentId: string) => Promise<AutoApplyReport>;
  /** Restaura el respaldo del último apply. */
  onUndo: (path: string, backupPath: string) => Promise<AutoApplyReport>;
  /** Abre el panel si estaba cerrado (p. ej. parche desde Asistencia). */
  onEnsureOpen?: () => void;
  /** Aviso visible a nivel app (banner); nunca silencio. */
  onPatchNotice?: (message: string) => void;
  /**
   * Eleva Aceptar/Rechazar/Deshacer al banner de App para que no queden
   * cortados por overflow del chat.
   */
  onReviewChrome?: (chrome: ReviewChromeLive | null) => void;
  /** Generación al cambiar de carpeta: limpia diff y avisos. */
  workspaceEpoch?: number;
  /**
   * Sólo `main` debe escuchar `assistant-propose-patch`.
   * La ventana Asistencia emite; no re-escucha (evitar juez stub).
   */
  acceptRemotePatches?: boolean;
  /** Clave de historial local por proyecto (sin API keys). */
  projectId?: string;
}

export default function ChatPanel({
  open,
  onClose,
  documentName,
  documentSource,
  analysis,
  catalogue,
  sample,
  treeOutline = "",
  onJudge,
  onConfirm,
  onUndo,
  onEnsureOpen,
  onPatchNotice,
  onReviewChrome,
  workspaceEpoch = 0,
  acceptRemotePatches = false,
  projectId = "",
}: ChatPanelProps) {
  const [config, setConfig] = useState<AiConfig>(() => loadConfig());
  useEffect(() => {
    let cancel = false;
    const epoch = keyEpochRef.current;
    void (async () => {
      const peeked = peekStoredSecret();
      if (peeked) {
        try {
          await saveKey(peeked.provider, peeked.secret, true);
          stripStoredSecret();
          keyEpochRef.current += 1;
          if (!cancel) {
            setConfig((current) => ({
              ...current,
              apiKey: "",
              hasKey: current.provider === peeked.provider ? true : current.hasKey,
              rememberKey: current.provider === peeked.provider ? true : current.rememberKey,
            }));
          }
        } catch {
          // Si el llavero no acepta la clave, el almacén viejo se queda intacto.
        }
      }
      try {
        const has = await keyExists(config.provider);
        if (!cancel && epoch === keyEpochRef.current) {
          setConfig((current) =>
            current.provider === config.provider ? { ...current, hasKey: has } : current,
          );
        }
      } catch {
        // Sin escritorio no hay llavero: el panel sigue sin clave.
      }
    })();
    return () => {
      cancel = true;
    };
  }, [config.provider]);
  const [settings, setSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    projectId ? loadChatHistory(projectId) : [],
  );
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
  const [autoApply, setAutoApply] = useState(() => readAutoApplyEnabled());
  const [review, setReview] = useState<{
    patch: string;
    report: AutoApplyReport;
    impactSummary?: string;
    /** Bloqueo duro del mapa (import roto o mapa caído) → sin Aceptar. */
    mapBlock?: string;
    mapWarn?: string;
    nextSource?: string;
    /** Más de un archivo: se escribe con liveMapApplyBatch, no con confirm. */
    batch?: BatchChange[];
  } | null>(null);
  const [liveMapText, setLiveMapText] = useState("");
  const [lastBackup, setLastBackup] = useState<{ path: string; backupPath: string } | null>(
    null,
  );

  const abortRef = useRef<AbortController | null>(null);
  /** `fail` si el IPC de Detener no llegó: no pintar «Consulta cancelada». */
  const stopOutcome = useRef<"ok" | "fail" | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const projectIdRef = useRef(projectId);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  /** Generación del llavero: invalida lecturas `keyExists` anteriores a un Guardar. */
  const keyEpochRef = useRef(0);

  // Historial por proyecto: guarda el hilo saliente y carga el entrante.
  useEffect(() => {
    const previous = projectIdRef.current;
    if (previous && previous !== projectId) {
      saveChatHistory(previous, messagesRef.current);
    }
    projectIdRef.current = projectId;
    setMessages(projectId ? loadChatHistory(projectId) : []);
    setUsages({});
    setTranslations({});
    setDraft("");
    setAttachments([]);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    saveChatHistory(projectId, messages);
  }, [projectId, messages]);
  const storeAvailable = useMemo(() => defaultStore() !== null, []);
  const liveModelIds = models.map((model) => model.id);
  const problems = configProblems(config, liveModelIds);
  const composerPayload = [draft.trim(), fileNotesForPrompt(attachments)]
    .filter((part) => part.length > 0)
    .join("\n\n");
  const sendGate = chatSendGate(config, composerPayload, pending, offline, liveModelIds);

  /** Prompt base (sin texto de usuario); el envío añade `userText` del turno. */
  const promptContextBase = useMemo(
    () => ({
      catalogue,
      sample,
      documentName,
      documentSource,
      analysis,
      treeOutline,
      liveMapText,
    }),
    [catalogue, sample, documentName, documentSource, analysis, treeOutline, liveMapText],
  );

  // §9.4 — subgrafo del mapa para el prompt (solo foco del documento abierto).
  useEffect(() => {
    let cancel = false;
    const focus = documentName.trim();
    if (!focus || focus === "<editor>") {
      setLiveMapText("");
      return;
    }
    void (async () => {
      try {
        const ctx = await liveMapContext([focus], 40);
        if (!cancel) {
          setLiveMapText(ctx.text || "");
        }
      } catch {
        if (!cancel) {
          setLiveMapText("");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [documentName, workspaceEpoch]);

  useEffect(() => {
    if (open && !settings) {
      draftRef.current?.focus();
    }
  }, [open, settings]);

  useEffect(() => {
    writeAutoApplyEnabled(autoApply);
  }, [autoApply]);

  const publishNotice = useCallback(
    (message: string) => {
      setNotice(message);
      onPatchNotice?.(message);
    },
    [onPatchNotice],
  );

  useEffect(() => {
    setReview(null);
    setLastBackup(null);
    setNotice(null);
    console.info(
      formatPatchDebug({
        phase: "root_reset",
        document: documentName,
        detail: `epoch=${workspaceEpoch}`,
      }),
    );
    // Sólo al cambiar de carpeta (epoch), no en cada rename del documento.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspaceEpoch es la señal
  }, [workspaceEpoch]);

  /** Abre el panel de diff (sin escribir). Siempre deja un aviso visible. */
  const beginReview = useCallback(
    async (patch: string) => {
      onEnsureOpen?.();
      const early = preflightPatch(patch, documentName);
      if (!early.ok) {
        console.info(formatPatchDebug(early.log));
        setReview(null);
        publishNotice(early.notice);
        return;
      }
      try {
        console.info(
          formatPatchDebug({
            phase: "judge",
            document: documentName,
            detail: `len=${early.code.length}`,
          }),
        );
        const batchFiles = filesFromUnifiedDiff(early.code);
        if (batchFiles.length > 1) {
          const hosts: Record<string, string> = {};
          for (const file of batchFiles) {
            try {
              const doc = await readProjectFile(file.path);
              hosts[file.path] = doc.source ?? "";
            } catch {
              hosts[file.path] = "";
            }
          }
          const merged = mergeUnifiedDiff(early.code, hosts);
          if (!merged.ok) {
            setReview({
              patch: early.code,
              report: {
                ...emptyReport(1),
                glyph: "∅",
                status: "neither",
                path: merged.path,
                previewDiff: early.code,
                canApply: false,
                verified: false,
                blockReason: merged.reason,
                judgmentId: "batch",
              },
              mapBlock: merged.reason,
            });
            publishNotice(merged.reason);
            return;
          }
          const batch: BatchChange[] = merged.files.map((file) => ({
            path: file.path,
            source: file.source,
          }));
          let mapBlock = "";
          let impactSummary = "";
          try {
            const impact = await liveMapImpact(batch.map((file) => file.path));
            impactSummary = impact.summary;
            for (const file of batch) {
              const gate = await liveMapGate(file.path, file.source);
              if (!gate.ok) {
                mapBlock = gate.blockReason || "el cambio rompería imports; no se escribe";
                break;
              }
            }
          } catch {
            mapBlock = "mapa no respondió; no se escribe";
            impactSummary = impactSummary || mapBlock;
          }
          setReview({
            patch: early.code,
            report: {
              ...emptyReport(1),
              glyph: "∅",
              status: "neither",
              path: batch[0]?.path ?? "",
              previewDiff: early.code,
              canApply: false,
              verified: false,
              blockReason: "lote de varios archivos",
              judgmentId: "batch",
            },
            impactSummary,
            mapBlock,
            batch,
          });
          publishNotice(
            mapBlock
              ? `${impactSummary || "Lote"} · ${mapBlock}`
              : impactSummary || `Lote de ${batch.length} archivos. Nada se ha escrito.`,
          );
          return;
        }
        const report = await onJudge(early.code);
        const resolved = resolvePatchAttempt(early.code, documentName, report);
        console.info(formatPatchDebug(resolved.log));
        if (resolved.outcome.kind === "review") {
          const line = Math.max(1, resolved.outcome.report.line || 1);
          const nextSource = spliceHost(documentSource, resolved.outcome.patch, line);
          let impactSummary = "";
          let mapBlock = "";
          let mapIpcOk = false;
          try {
            const impact = await liveMapImpact([documentName]);
            impactSummary = impact.summary;
            const gate = await liveMapGate(documentName, nextSource);
            mapIpcOk = true;
            if (!gate.ok) {
              mapBlock = gate.blockReason || "el cambio rompería imports";
              impactSummary = `${impactSummary} · ${mapBlock}`;
            }
          } catch {
            mapBlock = "mapa no respondió; no se escribe";
            impactSummary = impactSummary || mapBlock;
          }
          setReview({
            patch: resolved.outcome.patch,
            report: resolved.outcome.report,
            impactSummary,
            mapBlock,
            nextSource,
          });
          publishNotice(
            impactSummary
              ? `${resolved.notice} · ${impactSummary}`
              : resolved.notice,
          );
          // Auto-Apply: ⊤ verificado, mapa OK y sin bloqueo.
          if (
            autoApply &&
            mapIpcOk &&
            !mapBlock &&
            resolved.outcome.report.verified &&
            resolved.outcome.report.canApply
          ) {
            try {
              const applied = await onConfirm(
                resolved.outcome.patch,
                resolved.outcome.report.judgmentId,
              );
              if (applied.applied) {
                setLastBackup(
                  applied.backupPath
                    ? { path: applied.path, backupPath: applied.backupPath }
                    : null,
                );
                setReview(null);
                publishNotice(
                  `Auto-Apply ${applied.glyph}: ${applied.path}:${applied.line}. Respaldo ${applied.backupPath || "(sin ruta)"}.`,
                );
              }
            } catch (error) {
              publishNotice(reasonOf(error));
            }
          }
          return;
        }
        setReview(null);
        publishNotice(resolved.notice);
      } catch (error) {
        setReview(null);
        const message = reasonOf(error);
        console.info(
          formatPatchDebug({
            phase: "error",
            document: documentName,
            detail: message.slice(0, 160),
          }),
        );
        publishNotice(message);
      }
    },
    [autoApply, documentName, documentSource, onConfirm, onEnsureOpen, onJudge, publishNotice],
  );

  /**
   * «usar en el editor»: en `main` abre el diff; desde Asistencia emite a
   * la ventana principal y la enfoca.
   */
  const useInEditor = useCallback(
    (code: string) => {
      void (async () => {
        try {
          const vista = await currentVista();
          if (vista !== "main") {
            console.info(
              formatPatchDebug({
                phase: "emit",
                vista,
                document: documentName,
                detail: `len=${code.trim().length}`,
              }),
            );
            publishNotice("Enviando diff a la ventana principal…");
            await proposeEditorPatch(code);
            await openDeskWindow("main");
            publishNotice("Diff enviado a la ventana principal. Si no ves el panel, ábrelo en main.");
            return;
          }
          console.info(
            formatPatchDebug({
              phase: "ensure_open",
              vista: "main",
              document: documentName,
            }),
          );
          await beginReview(code);
        } catch (error) {
          const message = reasonOf(error);
          console.info(
            formatPatchDebug({
              phase: "error",
              document: documentName,
              detail: message.slice(0, 160),
            }),
          );
          publishNotice(message);
        }
      })();
    },
    [beginReview, documentName, publishNotice],
  );

  // Parches desde Asistencia: main escucha aunque el chat esté cerrado.
  useEffect(() => {
    if (!acceptRemotePatches || !shouldListenForPropose(inDesktop(), open)) {
      return undefined;
    }
    let cancel = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ patch?: string }>(PROPOSE_PATCH_EVENT, (event) => {
          if (cancel) {
            return;
          }
          const patch = typeof event.payload?.patch === "string" ? event.payload.patch : "";
          console.info(
            formatPatchDebug({
              phase: "recv",
              vista: "main",
              document: documentName,
              detail: `len=${patch.trim().length}`,
            }),
          );
          onEnsureOpen?.();
          if (!patch.trim()) {
            publishNotice("Se recibió un parche vacío desde Asistencia.");
            return;
          }
          void beginReview(patch);
        });
      } catch (error) {
        console.info(
          formatPatchDebug({
            phase: "error",
            detail: `listen: ${reasonOf(error).slice(0, 120)}`,
          }),
        );
      }
    })();
    return () => {
      cancel = true;
      unlisten?.();
    };
  }, [acceptRemotePatches, beginReview, documentName, onEnsureOpen, open, publishNotice]);

  /** Adjunta archivos de cualquier tipo (arrastrados, pegados o elegidos). */
  const attach = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      const { attachments: added, errors } = await prepareAttachments(files, attachments.length);
      if (added.length > 0) {
        setAttachments((previous) => [...previous, ...added]);
      }
      setNotice(errors.length > 0 ? errors.join(" · ") : null);
    },
    [attachments.length],
  );

  /** Envía el turno actual al proveedor elegido. */
  const send = useCallback(async () => {
    const notes = fileNotesForPrompt(attachments);
    const text = [draft.trim(), notes].filter((part) => part.length > 0).join("\n\n");
    if (chatSendGate(config, text, pending, offline, models.map((m) => m.id)) !== null) {
      return;
    }
    const user: ChatMessage = {
      id: newId(),
      role: "user",
      text,
      images: attachments.filter(isVisionAttachment),
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
      await armAiTurn();
      if (offline) {
        const local = await localComplete(text, controller.signal);
        if (controller.signal.aborted) {
          throw new DOMException("abortado", "AbortError");
        }
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
      const system = baraSystemPrompt({ ...promptContextBase, userText: text });
      if (typeof console !== "undefined" && console.debug) {
        const budget = summarizeBudget(promptBudgetParts({ ...promptContextBase, userText: text }));
        console.debug(
          `[bara-prompt] «${text.slice(0, 40)}» ≈${budget.totalTokensEst} tok (est.) · ${budget.totalChars} chars`,
          budget.byName,
        );
      }
      const streamId = newId();
      setMessages((previous) => [
        ...previous,
        {
          id: streamId,
          role: "assistant",
          text: "",
          images: [],
          model: config.model,
          createdAt: Date.now(),
          error: null,
        },
      ]);
      let readCount = 0;
      const result = await sendChat(
        await commitKey(config, setConfig, () => {
          keyEpochRef.current += 1;
        }),
        history,
        system,
        controller.signal,
        async (name, argsJson) => {
          if (name !== READ_FILE_TOOL) {
            return `herramienta no soportada: ${name}`;
          }
          let path = "";
          try {
            const parsed = JSON.parse(argsJson) as { path?: unknown };
            path = typeof parsed.path === "string" ? parsed.path.trim() : "";
          } catch {
            path = "";
          }
          if (!path) {
            return "falta el parámetro path";
          }
          readCount += 1;
          if (readCount > MAX_READS_PER_TURN) {
            setNotice(`Tope de ${MAX_READS_PER_TURN} lecturas por turno; omitida «${path}».`);
            return `tope de lecturas (${MAX_READS_PER_TURN}) alcanzado; no se leyó «${path}».`;
          }
          setNotice(`📄 leyendo «${path}» (${readCount}/${MAX_READS_PER_TURN})`);
          const doc = await readProjectFile(path);
          const body = doc.source ?? "";
          const cap = 24_000;
          const clipped =
            [...body].length > cap
              ? `${[...body].slice(0, cap).join("")}\n# … recortado`
              : body;
          return wrapFileDataPayload(doc.path || path, clipped);
        },
        (partial) => {
          setMessages((previous) =>
            previous.map((message) =>
              message.id === streamId ? { ...message, text: partial, error: null } : message,
            ),
          );
        },
      );
      if (result.acceptedModel && result.acceptedModel !== config.model) {
        const next = { ...config, model: result.acceptedModel };
        setConfig(next);
        saveConfig(next);
        setNotice(
          `El proveedor no admite «${config.model}». A partir de ahora se usa ${result.acceptedModel}.`,
        );
      }
      const id = streamId;
      const usage = result.usage;
      const toolsUsed = result.toolsUsed;
      setMessages((previous) =>
        previous.map((message) =>
          message.id === id
            ? {
                ...message,
                text: result.text,
                model: result.model,
                error: null,
                toolsUsed,
              }
            : message,
        ),
      );
      if (usage) {
        setUsages((previous) => ({ ...previous, [id]: usage }));
      }
      if (toolsUsed && toolsUsed.length > 0) {
        setNotice(`📄 leyó ${toolsUsed.join(", ")}`);
      }
      // B7: sólo el primer fence ```bara (no el primer fence de cualquier lenguaje).
      if (autoApply) {
        const block = firstBaraCodeBlock(result.text);
        if (block) {
          await beginReview(block);
        }
      }
    } catch (error) {
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        /abort|cancel/i.test(reasonOf(error));
      if (aborted) {
        if (stopOutcome.current !== "fail") {
          setNotice("Consulta cancelada.");
        }
        return;
      }
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
  }, [
    attachments,
    autoApply,
    beginReview,
    config,
    draft,
    messages,
    offline,
    pending,
    promptContextBase,
  ]);

  const acceptReview = useCallback(async () => {
    if (!review) {
      return;
    }
    if (review.mapBlock) {
      publishNotice(review.mapBlock);
      return;
    }
    try {
      // §9.4b — revalidar puerta del mapa antes de escribir.
      if (review.nextSource && documentName) {
        try {
          const gate = await liveMapGate(documentName, review.nextSource);
          if (!gate.ok) {
            const msg =
              gate.blockReason ||
              "el cambio rompería imports; no se escribió";
            setNotice(msg);
            publishNotice(msg);
            setReview((prev) =>
              prev ? { ...prev, mapBlock: msg, impactSummary: gate.impact.summary } : prev,
            );
            return;
          }
        } catch {
          const warn = "mapa no respondió al revalidar; no se escribe";
          setNotice(warn);
          publishNotice(warn);
          setReview((prev) => (prev ? { ...prev, mapBlock: warn } : prev));
          return;
        }
      }
      if (review.batch && review.batch.length > 1) {
        try {
          for (const change of review.batch) {
            const gate = await liveMapGate(change.path, change.source);
            if (!gate.ok) {
              const msg = gate.blockReason || "el cambio rompería imports; no se escribió";
              setNotice(msg);
              publishNotice(msg);
              setReview((prev) => (prev ? { ...prev, mapBlock: msg } : prev));
              return;
            }
          }
        } catch {
          const warn = "mapa no respondió al revalidar; no se escribe";
          setNotice(warn);
          publishNotice(warn);
          setReview((prev) => (prev ? { ...prev, mapBlock: warn } : prev));
          return;
        }
        const applied = await liveMapApplyBatch(review.batch);
        if (!applied.applied) {
          setNotice(applied.detail || "el lote no se escribió");
          publishNotice(applied.detail || "el lote no se escribió");
          return;
        }
        setNotice(applied.detail);
        publishNotice(applied.detail);
        setReview(null);
        return;
      }
      const report = await onConfirm(review.patch, review.report.judgmentId);
      if (report.applied) {
        setLastBackup(
          report.backupPath
            ? { path: report.path, backupPath: report.backupPath }
            : null,
        );
        const msg = `Aplicado ${report.glyph}: ${report.path}:${report.line}. Respaldo en ${report.backupPath || "(sin ruta)"}.`;
        setNotice(msg);
        publishNotice(msg);
      } else {
        setNotice(report.blockReason || `No se escribió (${report.glyph}).`);
      }
      setReview(null);
    } catch (error) {
      setNotice(reasonOf(error));
    }
  }, [documentName, onConfirm, publishNotice, review]);

  const rejectReview = useCallback(() => {
    setReview(null);
    const msg = "Diff rechazado: no se escribió nada.";
    setNotice(msg);
    publishNotice(msg);
  }, [publishNotice]);

  const undoLast = useCallback(async () => {
    if (!lastBackup) {
      return;
    }
    try {
      const report = await onUndo(lastBackup.path, lastBackup.backupPath);
      if (report.applied) {
        const msg = `Deshacer: restaurado ${report.path} desde ${lastBackup.backupPath}.`;
        setNotice(msg);
        publishNotice(msg);
      } else {
        setNotice(report.blockReason || "No se pudo deshacer.");
      }
      setLastBackup(null);
    } catch (error) {
      setNotice(reasonOf(error));
    }
  }, [lastBackup, onUndo, publishNotice]);

  // Banner de App + barra sticky: misma lógica de acciones.
  useEffect(() => {
    if (!onReviewChrome) {
      return;
    }
    const base = buildReviewChrome(review, lastBackup);
    if (!base) {
      onReviewChrome(null);
      return;
    }
    onReviewChrome({
      ...base,
      accept: () => {
        void acceptReview();
      },
      reject: rejectReview,
      undo: () => {
        void undoLast();
      },
    });
  }, [acceptReview, lastBackup, onReviewChrome, rejectReview, review, undoLast]);

  /** B8 — Detener: aborta el turno JS y corta HTTP + kernel. Si el IPC falla, no dice «cancelada». */
  const stop = useCallback(() => {
    void (async () => {
      const errors: string[] = [];
      try {
        await cancelAiInFlight();
      } catch (error) {
        errors.push(reasonOf(error));
      }
      try {
        await interruptKernel();
      } catch (error) {
        errors.push(reasonOf(error));
      }
      if (errors.length > 0) {
        stopOutcome.current = "fail";
        setNotice(`No se pudo detener: ${errors.join(" · ")}`);
      } else {
        stopOutcome.current = "ok";
        setNotice("Consulta cancelada.");
      }
      abortRef.current?.abort();
    })();
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

  /** Persiste los ajustes. Si hay borrador, pasa al llavero y sale de la interfaz. */
  const persist = useCallback(() => {
    void (async () => {
      try {
        const next = await commitKey(config, setConfig, () => {
          keyEpochRef.current += 1;
        });
        const saved = saveConfig(next);
        setNotice(
          saved
            ? next.hasKey
              ? next.rememberKey
                ? "Ajustes guardados. Clave en llavero."
                : "Ajustes guardados. Clave sólo en esta sesión."
              : "Ajustes guardados."
            : "No se pudo guardar: el almacén del navegador no está disponible.",
        );
      } catch (error) {
        setNotice(reasonOf(error));
      }
    })();
  }, [config]);

  /** Borra ajustes y la clave del llavero. */
  const forget = useCallback(() => {
    void (async () => {
      try {
        await deleteKey(config.provider);
      } catch (error) {
        setNotice(reasonOf(error));
      }
      forgetConfig();
      setConfig({ ...loadConfig(), hasKey: false });
      setModels([]);
      setModelStatus(null);
      setNotice("Ajustes olvidados. La clave ya no está en el llavero.");
    })();
  }, [config.provider]);

  /** Lista real de modelos de la cuenta (requiere una clave válida). */
  const fetchModels = useCallback(async () => {
    setModelStatus("consultando…");
    try {
      const ready = await commitKey(config, setConfig, () => {
        keyEpochRef.current += 1;
      });
      const list = await listModels(ready);
      setModels(list);
      setModelStatus(`${list.length} modelos`);
      if (list.length > 0) {
        setConfig((current) => {
          const stillValid = list.some((model) => model.id === current.model.trim());
          if (stillValid) {
            return current;
          }
          const preferred =
            list.find((model) => /flash/i.test(model.id)) ??
            list.find((model) => /deepseek/i.test(model.id)) ??
            list[0];
          return { ...current, model: preferred.id };
        });
      }
      setNotice(null);
    } catch (error) {
      setModelStatus(null);
      setNotice(reasonOf(error));
    }
  }, [config]);

  /** Sonda DNS→TCP→TLS→HTTP→modelos (la clave no sale del proceso). */
  const runProbe = useCallback(async () => {
    setModelStatus("sonda…");
    try {
      const ready = await commitKey(config, setConfig, () => {
        keyEpochRef.current += 1;
      });
      const report = await probeConnection(ready.provider, ready.baseUrl);
      const line = report.steps
        .map((step) => `${step.ok ? "OK" : "FALLO"} ${step.name}: ${step.detail}`)
        .join(" · ");
      setModelStatus(report.ok ? `sonda OK · ${report.models.length} modelos` : "sonda con fallos");
      setNotice(line);
      if (report.models.length > 0) {
        setModels(report.models.map((id) => ({ id, label: id } as ModelInfo)));
      }
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
        <BrandMark size={24} variant="avatar" title="AETHER-Ω" className="ai-avatar" />
        <h2 className="ai-head-title">ASISTENTE</h2>
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
        <button
          type="button"
          title="Borrar historial de este proyecto (local)"
          disabled={messages.length === 0 || !projectId}
          onClick={() => {
            if (!projectId) {
              return;
            }
            clearChatHistory(projectId);
            setMessages([]);
            setUsages({});
            setTranslations({});
            setNotice("Historial de este proyecto borrado.");
          }}
        >
          borrar historial
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
            onProbe={() => {
              void runProbe();
            }}
            onClose={() => setSettings(false)}
          />
          <details className="ai-report">
            <summary className="muted">
              prompt del sistema (
              {baraSystemPrompt({ ...promptContextBase, userText: draft }).length} caracteres)
            </summary>
            <pre className="ai-code-body">
              {baraSystemPrompt({ ...promptContextBase, userText: draft })}
            </pre>
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
                onUseCode={useInEditor}
                onTranslate={(id, text) => {
                  void translate(id, text);
                }}
              />
            ))}
            {pending ? (
              <div className="ai-pending-bar" role="status">
                <span className="muted">consultando al modelo…</span>
                <button type="button" className="ai-cancel" onClick={stop}>
                  Cancelar
                </button>
              </div>
            ) : null}
          </div>

          {/* Barra sticky: acciones SIEMPRE visibles; el diff scrollea aparte. */}
          {review || lastBackup ? (
            <div className="ai-review-dock" role="region" aria-label="Revisión del parche">
              <div className="row ai-review-actions">
                {review ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(review.mapBlock)}
                      title={review.mapBlock || undefined}
                      onClick={() => void acceptReview()}
                    >
                      Aceptar
                    </button>
                    <button type="button" onClick={rejectReview}>
                      Rechazar
                    </button>
                  </>
                ) : null}
                {lastBackup ? (
                  <button type="button" title={lastBackup.backupPath} onClick={() => void undoLast()}>
                    Deshacer
                  </button>
                ) : null}
              </div>
              {review ? (
                <div className="ai-review">
                  {!review.report.verified || !review.report.canApply ? (
                    <p className="ai-warn-banner" role="status">
                      {review.report.blockReason ||
                        review.report.unverifiedReason ||
                        "propuesta no verificada"}
                      {" — "}
                      Auto-Apply bloqueado; Aceptar/Rechazar siguen disponibles.
                    </p>
                  ) : null}
                  <p className="muted">
                    Diff propuesto ({review.report.glyph}
                    {documentName.toLowerCase().endsWith(".bara")
                      ? review.report.verified
                        ? " · verificado"
                        : " · no verificado"
                      : review.report.status === "both"
                        ? " · sin choque"
                        : " · equilibrado"}
                    ). Aceptar escribe con respaldo; rechazar no toca el disco.
                  </p>
                  {review.impactSummary ? (
                    <p className="ai-impact" role="status">
                      Mapa: {review.impactSummary}
                    </p>
                  ) : null}
                  {review.mapBlock ? (
                    <p className="ai-warn-banner" role="alert">
                      {review.mapBlock}
                    </p>
                  ) : null}
                  {review.mapWarn && !review.mapBlock ? (
                    <p className="ai-warn-banner" role="status">
                      {review.mapWarn}
                    </p>
                  ) : null}
                  <pre className="ai-code-body ai-diff">{review.report.previewDiff}</pre>
                </div>
              ) : lastBackup ? (
                <p className="muted ai-backup-hint">{lastBackup.backupPath}</p>
              ) : null}
            </div>
          ) : null}

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
                    {isVisionAttachment(image) && image.dataUrl ? (
                      <img src={image.dataUrl} alt={image.name} />
                    ) : (
                      <span className="ai-chip-file" aria-hidden="true">
                        📎
                      </span>
                    )}
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
              placeholder="Pregunte sobre Shoresh, pegue un fragmento o suelte un archivo…"
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
              {pending ? (
                <button type="button" className="ai-cancel" onClick={stop} title="Cancelar consulta">
                  Cancelar
                </button>
              ) : (
                <button type="submit" disabled={sendGate !== null} title={sendGate ?? "Enviar"}>
                  Enviar
                </button>
              )}
              <label className="ai-attach" title="Subir archivo (cualquier tipo)">
                📎 Subir archivo (cualquier tipo)
                <input
                  type="file"
                  accept="*/*"
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
                disabled={draft.trim().length === 0 || pending}
                onClick={() => {
                  void translate("borrador", draft);
                }}
              >
                Traducir a Shoresh
              </button>
              <button type="button" onClick={selfCheck} disabled={pending}>
                Autodiagnóstico
              </button>
            </div>

            {translations.borrador ? (
              <TranslationBox result={translations.borrador} onUseCode={useInEditor} />
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
        {!mine ? (
          <BrandMark size={22} variant="avatar" className="ai-avatar" title="AETHER-Ω" />
        ) : null}
        <span className="muted">{mine ? "tú" : message.model || "asistente"}</span>
        <span className="grow" />
        {usage ? (
          <span className="muted">
            {usage.inputTokens}→{usage.outputTokens} tokens
          </span>
        ) : null}
        {message.toolsUsed && message.toolsUsed.length > 0 ? (
          <span className="muted" title="Herramienta leer_archivo">
            📄 leyó {message.toolsUsed.join(", ")}
          </span>
        ) : null}
        {hasText ? (
          <button
            type="button"
            title="Copiar mensaje"
            onClick={() => {
              void writeClipboard(message.text);
            }}
          >
            Copiar
          </button>
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
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    let alive = true;
    setVerified(false);
    if (!result.program.trim()) {
      return () => {
        alive = false;
      };
    }
    void import("../baraVerify")
      .then(({ verifyBaraBlock }) => verifyBaraBlock(result.program))
      .then((status) => {
        if (alive) {
          setVerified(status === "verified");
        }
      })
      .catch(() => {
        if (alive) {
          setVerified(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [result.program]);

  return (
    <div className="ai-code">
      <div className="ai-code-head">
        <span className="muted">
          Shoresh · {roots}
          {extra}
          {result.program ? (verified ? " · verificado" : " · no verificado") : ""}
        </span>
        <span className="grow" />
        {result.program ? (
          <button
            type="button"
            title={
              verified
                ? "Abrir diff en el editor"
                : "Abrir diff (no verificado: podrás Aceptar a mano)"
            }
            onClick={() => onUseCode(result.program)}
          >
            usar en el editor
          </button>
        ) : null}
      </div>
      <pre className="ai-code-body">{result.program || "(sin programa)"}</pre>
    </div>
  );
}


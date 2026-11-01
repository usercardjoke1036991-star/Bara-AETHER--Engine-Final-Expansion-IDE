// Historial de chat por proyecto (localStorage). Nunca guarda API keys.

import type { ChatMessage, ImageAttachment } from "./types";

const KEY = "bara.chat.byProject.v1";
const MAX_MESSAGES = 80;

type Bucket = Record<string, ChatMessage[]>;

function readAll(): Bucket {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Bucket;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeAll(bucket: Bucket): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(bucket));
  } catch {
    // cuota / privado
  }
}

/** Quita cargas útiles pesadas; nunca persiste claves. */
export function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-MAX_MESSAGES).map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    model: message.model,
    createdAt: message.createdAt,
    error: message.error,
    toolsUsed: message.toolsUsed,
    images: message.images.map(sanitizeAttachment),
  }));
}

function sanitizeAttachment(image: ImageAttachment): ImageAttachment {
  return {
    id: image.id,
    name: image.name,
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    kind: image.kind,
    // Sin base64/dataUrl: evita secretos embebidos y explotar la cuota.
    base64: "",
    dataUrl: "",
    textContent: image.textContent ? image.textContent.slice(0, 32_768) : undefined,
  };
}

export function loadChatHistory(projectId: string): ChatMessage[] {
  const id = projectId.trim();
  if (!id) {
    return [];
  }
  const bucket = readAll();
  const list = bucket[id];
  return Array.isArray(list) ? sanitizeMessages(list) : [];
}

export function saveChatHistory(projectId: string, messages: ChatMessage[]): void {
  const id = projectId.trim();
  if (!id) {
    return;
  }
  const bucket = readAll();
  bucket[id] = sanitizeMessages(messages);
  writeAll(bucket);
}

export function clearChatHistory(projectId: string): void {
  const id = projectId.trim();
  if (!id) {
    return;
  }
  const bucket = readAll();
  delete bucket[id];
  writeAll(bucket);
}

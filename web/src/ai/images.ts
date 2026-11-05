// Normalización de imágenes adjuntas: selección, arrastrar y soltar y pegado.
//
// El panel acepta capturas de pantalla, diagramas de arquitectura y ejemplos de
// sintaxis Bara manuscrita. Cada imagen se convierte a data URL + base64 y se
// acota antes de salir del equipo:
//  · sólo tipos que ambos proveedores aceptan (PNG, JPEG, WEBP y GIF);
//  · lado mayor <= 1568 px (el óptimo que documenta Anthropic); el GIF viaja
//    intacto para no perder la animación;
//  · carga útil <= 4 MB por imagen y <= 6 imágenes por mensaje.

import type { ImageAttachment } from "./types";

/** Tipos MIME que aceptan los dos proveedores. */
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Lado mayor al que se reduce una imagen (óptimo documentado por Anthropic). */
export const MAX_EDGE = 1568;

/** Presupuesto de carga útil por imagen, en bytes de base64. */
export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

/** Máximo de imágenes por mensaje. */
export const MAX_ATTACHMENTS = 6;

/** Evento que Asistencia envía sólo a la ventana `main`. */
export const DESK_ATTACHMENT_EVENT = "ai-desk-attachment";

/** Adjunto de texto llegado desde Asistencia. `null` si el fragmento está vacío. */
export function attachmentFromDesk(name: string, source: string): ImageAttachment | null {
  const label = name.trim();
  if (!label || !source.trim()) {
    return null;
  }
  return {
    id: `desk-${attachmentId(source.length)}`,
    name: label,
    mediaType: "text/plain",
    base64: "",
    dataUrl: "",
    width: 0,
    height: 0,
    bytes: new TextEncoder().encode(source).length,
    kind: "file",
    textContent: source,
  };
}

/** Identificador único para las claves de React. */
export function attachmentId(index: number): string {
  return `adjunto-${Date.now().toString(36)}-${index}`;
}

/** Peso aproximado de una carga útil base64, en bytes. */
export function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

/** Compone una data URL canónica. */
export function toDataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

/** Separa una data URL en tipo MIME y carga útil. */
export function splitDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl);
  if (!match) {
    return { mediaType: "", base64: "" };
  }
  return { mediaType: match[1] ?? "", base64: match[3] ?? "" };
}

/** Tamaño legible para la interfaz (bytes → "240 KB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** ¿Es un MIME de visión admitido por los proveedores? */
export function isVisionMedia(mediaType: string): boolean {
  return ACCEPTED_TYPES.includes(mediaType);
}

/** Cupo de bytes para adjuntos no-imagen embebidos en el mensaje. */
export const MAX_FILE_BYTES = 256 * 1024;

/** Separa imágenes de visión de cualquier otro archivo (todos admitidos). */
export function acceptedFiles(files: File[]): { ok: File[]; rejected: string[] } {
  // Compat: todo archivo entra; el rechazo queda para cupos/tamaño en prepare*.
  return { ok: [...files], rejected: [] };
}

/** ¿El adjunto viaja como imagen multimodal? */
export function isVisionAttachment(attachment: ImageAttachment): boolean {
  return (attachment.kind ?? "image") === "image" && isVisionMedia(attachment.mediaType);
}

/** Lee un archivo como data URL. */
function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("no se pudo leer la imagen"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("la lectura de la imagen no devolvió texto"));
      }
    };
    reader.readAsDataURL(file);
  });
}

/** Decodifica la imagen para poder medirla y reducirla. */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("la imagen no se pudo decodificar"));
    image.src = dataUrl;
  });
}

/** Redibuja la imagen a la escala indicada conservando el tipo pedido. */
function drawScaled(image: HTMLImageElement, scale: number, mediaType: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("el navegador no ofreció un lienzo 2D para reducir la imagen");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // El PNG conserva la nitidez del texto de una captura; el JPEG se reserva
  // para fotografías o para el último recurso de tamaño.
  return canvas.toDataURL(mediaType === "image/png" ? "image/png" : "image/jpeg", 0.92);
}

/**
 * Convierte un archivo en adjunto multimodal listo para enviar.
 *
 * `width` y `height` describen la imagen **original**: es lo que el usuario
 * reconoce en la miniatura; el envío puede ir reducido.
 */
export async function prepareImage(file: File, index = 0): Promise<ImageAttachment> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    const name = file.name || "imagen";
    throw new Error(`${name}: tipo no admitido (${file.type || "desconocido"})`);
  }
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  let dataUrl = original;
  if (file.type !== "image/gif" && longest > MAX_EDGE) {
    dataUrl = drawScaled(image, MAX_EDGE / longest, file.type);
  }
  let { mediaType, base64 } = splitDataUrl(dataUrl);
  if (!mediaType) {
    mediaType = file.type;
  }
  if (base64Bytes(base64) > MAX_PAYLOAD_BYTES) {
    // Último recurso: re-codificar en JPEG (mucho más ligero en fotografías).
    const jpeg = drawScaled(image, Math.min(1, MAX_EDGE / longest), "image/jpeg");
    const retry = splitDataUrl(jpeg);
    base64 = retry.base64;
    mediaType = retry.mediaType || "image/jpeg";
  }
  if (base64Bytes(base64) > MAX_PAYLOAD_BYTES) {
    const name = file.name || "imagen";
    throw new Error(`${name}: supera 4 MB incluso reducida; usa una captura más pequeña`);
  }
  return {
    id: attachmentId(index),
    name: file.name || `pegado-${index + 1}`,
    mediaType,
    base64,
    dataUrl: toDataUrl(mediaType, base64),
    width: image.naturalWidth,
    height: image.naturalHeight,
    bytes: base64Bytes(base64),
  };
}

/** Adjunta un archivo no-imagen: se embebe como texto en el turno. */
export async function prepareFile(file: File, index = 0): Promise<ImageAttachment> {
  const name = file.name || `archivo-${index + 1}`;
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${name}: supera ${formatBytes(MAX_FILE_BYTES)}; divide el archivo`);
  }
  let textContent = "";
  try {
    textContent = await file.text();
  } catch {
    throw new Error(`${name}: no se pudo leer el archivo`);
  }
  if (textContent.length > MAX_FILE_BYTES) {
    textContent = textContent.slice(0, MAX_FILE_BYTES);
  }
  return {
    id: attachmentId(index),
    name,
    mediaType: file.type || "application/octet-stream",
    base64: "",
    dataUrl: "",
    width: 0,
    height: 0,
    bytes: file.size,
    kind: "file",
    textContent,
  };
}

/** Prepara un archivo cualquiera: imagen multimodal o adjunto de texto. */
export async function prepareAnyFile(file: File, index = 0): Promise<ImageAttachment> {
  if (isVisionMedia(file.type)) {
    const image = await prepareImage(file, index);
    return { ...image, kind: "image" };
  }
  // Algunos SO no rellenan MIME en PNG/JPEG; intenta por extensión.
  const lower = (file.name || "").toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/.test(lower)) {
    try {
      const image = await prepareImage(
        new File([file], file.name, {
          type:
            lower.endsWith(".png")
              ? "image/png"
              : lower.endsWith(".webp")
                ? "image/webp"
                : lower.endsWith(".gif")
                  ? "image/gif"
                  : "image/jpeg",
        }),
        index,
      );
      return { ...image, kind: "image" };
    } catch {
      // cae a archivo de texto
    }
  }
  return prepareFile(file, index);
}

/** Prepara varios archivos respetando el cupo de adjuntos por mensaje. */
export async function prepareImages(
  files: File[],
  already: number,
): Promise<{ attachments: ImageAttachment[]; errors: string[] }> {
  return prepareAttachments(files, already);
}

/** Prepara imágenes y archivos de cualquier tipo (cupo compartido). */
export async function prepareAttachments(
  files: File[],
  already: number,
): Promise<{ attachments: ImageAttachment[]; errors: string[] }> {
  const { ok, rejected } = acceptedFiles(files);
  const errors = [...rejected];
  const room = Math.max(0, MAX_ATTACHMENTS - already);
  const attachments: ImageAttachment[] = [];
  for (let index = 0; index < ok.length && index < room; index += 1) {
    try {
      attachments.push(await prepareAnyFile(ok[index], already + index));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (ok.length > room) {
    errors.push(`sólo se admiten ${MAX_ATTACHMENTS} adjuntos por mensaje`);
  }
  return { attachments, errors };
}

/** Texto a inyectar en el mensaje a partir de adjuntos no-imagen. */
export function fileNotesForPrompt(attachments: ImageAttachment[]): string {
  const notes = attachments.filter((item) => !isVisionAttachment(item));
  if (notes.length === 0) {
    return "";
  }
  return notes
    .map((item) => {
      const body = (item.textContent ?? "").trim();
      const header = `--- adjunto: ${item.name} (${formatBytes(item.bytes)}) ---`;
      return body.length > 0 ? `${header}\n${body}` : header;
    })
    .join("\n\n");
}

/** Archivos de un evento de arrastrar y soltar (o del portapapeles). */
export function filesFromDataTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) {
    return [];
  }
  const files: File[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }
  if (files.length > 0) {
    return files;
  }
  return Array.from(transfer.files);
}

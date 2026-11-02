/** A8 — reparte el texto final en trozos para la UI (cancelable). */

export async function streamTextToUi(
  text: string,
  onDelta: (partial: string) => void,
  signal?: AbortSignal,
  chunkSize = 24,
): Promise<string> {
  if (!text) {
    onDelta("");
    return "";
  }
  let acc = "";
  for (let index = 0; index < text.length; index += chunkSize) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("abortado", "AbortError");
    }
    acc += text.slice(index, index + chunkSize);
    onDelta(acc);
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }
  return acc;
}

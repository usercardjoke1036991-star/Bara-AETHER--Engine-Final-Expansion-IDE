/**
 * B2 — envuelve trabajo asíncrono con `setBusy(true/false)`.
 * Si `body` lanza (p. ej. `listen` falla), `busy` vuelve a false en el finally.
 */
export async function runWithBusy(
  setBusy: (busy: boolean) => void,
  body: () => Promise<void>,
): Promise<void> {
  setBusy(true);
  try {
    await body();
  } finally {
    setBusy(false);
  }
}

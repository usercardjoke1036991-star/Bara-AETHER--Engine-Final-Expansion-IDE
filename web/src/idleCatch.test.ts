import { describe, expect, it, vi } from "vitest";

/**
 * B2 — contrato del call-site idle: catch publica error; finally limpia el aviso.
 * (misma cadena que App / Cockpit usan con IdleNote).
 */
describe("B2 idleApply/Dismiss catch + finally", () => {
  it("rechazo de idleApply → error visible e idle limpio", async () => {
    const setError = vi.fn();
    const setIdle = vi.fn();
    const describeError = (failure: unknown) =>
      failure instanceof Error ? failure.message : String(failure);
    const idleApply = vi.fn(async () => {
      throw new Error("idle denegado");
    });

    await idleApply()
      .catch((failure: unknown) => {
        setError(describeError(failure));
      })
      .finally(() => {
        setIdle(null);
      });

    expect(setError).toHaveBeenCalledWith("idle denegado");
    expect(setIdle).toHaveBeenCalledWith(null);
  });
});

import { describe, expect, it } from "vitest";

import { runWithBusy } from "./busyGuard";

describe("B2 runWithBusy", () => {
  it("si body falla (p. ej. listen), busy vuelve a false", async () => {
    const flags: boolean[] = [];
    const setBusy = (busy: boolean) => {
      flags.push(busy);
    };
    await expect(
      runWithBusy(setBusy, async () => {
        throw new Error("listen falló");
      }),
    ).rejects.toThrow(/listen/);
    expect(flags).toEqual([true, false]);
  });

  it("si body ok, busy true luego false", async () => {
    const flags: boolean[] = [];
    await runWithBusy((busy) => flags.push(busy), async () => undefined);
    expect(flags).toEqual([true, false]);
  });
});

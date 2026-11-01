import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetRecent,
  loadRecents,
  mergeShelfDisplay,
  rememberShelf,
  shortPath,
} from "./projectRecents";
import { clearChatHistory, loadChatHistory, saveChatHistory, sanitizeMessages } from "./ai/chatHistory";
import { projectKey } from "./ai/projectKey";
import type { ChatMessage } from "./ai/types";

describe("shortPath", () => {
  it("recorta paths largos", () => {
    expect(shortPath("C:/a/b", 42)).toBe("C:/a/b");
    expect(shortPath("C:/Users/Vexor/Downloads/bara-ide/samples", 20)).toMatch(/^…/);
  });
});

describe("projectKey", () => {
  it("normaliza \\?\\ de Windows al mismo id", () => {
    expect(projectKey(String.raw`\\?\C:\Users\Vexor\Downloads\BAR`)).toBe(
      "c:/users/vexor/downloads/bar",
    );
    expect(projectKey("C:/Users/Vexor/Downloads/BAR")).toBe(
      "c:/users/vexor/downloads/bar",
    );
  });
});

describe("projectRecents", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persiste el estante y une recientes fuera del shelf vivo", () => {
    rememberShelf({
      activeId: "aaa",
      roots: [
        { id: "aaa", path: "C:/proj/a", name: "a", active: true },
        { id: "bbb", path: "C:/proj/b", name: "b", active: false },
      ],
    });
    const stored = loadRecents();
    expect(stored.roots).toHaveLength(2);
    expect(stored.activeId).toBe("aaa");

    const display = mergeShelfDisplay(
      {
        activeId: "aaa",
        roots: [{ id: "aaa", path: "C:/proj/a", name: "a", active: true }],
      },
      stored.roots,
    );
    expect(display.map((item) => item.id)).toEqual(["aaa", "bbb"]);
    expect(display[1]?.active).toBe(false);

    forgetRecent("bbb");
    expect(loadRecents().roots.map((item) => item.id)).toEqual(["aaa"]);
  });
});

describe("chatHistory por proyecto", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("separa hilos y no guarda base64", () => {
    const keyA = projectKey("C:/proj/a");
    const keyB = projectKey("C:/proj/b");
    const msg = (text: string): ChatMessage => ({
      id: text,
      role: "user",
      text,
      model: "",
      createdAt: 1,
      error: null,
      images: [
        {
          id: "1",
          name: "x.png",
          mediaType: "image/png",
          base64: "SECRETDATA",
          dataUrl: "data:image/png;base64,SECRETDATA",
          width: 1,
          height: 1,
          bytes: 10,
        },
      ],
    });
    saveChatHistory(keyA, [msg("hola-a")]);
    saveChatHistory(keyB, [msg("hola-b")]);
    expect(loadChatHistory(keyA)[0]?.text).toBe("hola-a");
    expect(loadChatHistory(keyB)[0]?.text).toBe("hola-b");
    expect(loadChatHistory(keyA)[0]?.images[0]?.base64).toBe("");
    expect(sanitizeMessages([msg("x")])[0]?.images[0]?.dataUrl).toBe("");
    clearChatHistory(keyA);
    expect(loadChatHistory(keyA)).toHaveLength(0);
    expect(loadChatHistory(keyB)).toHaveLength(1);
  });
});

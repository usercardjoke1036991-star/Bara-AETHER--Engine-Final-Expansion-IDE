import { describe, expect, it } from "vitest";

import {
  LOCAL_ACCEPTED_KEY,
  LOCAL_CONFIRM_MESSAGE,
  PROVIDER_ENDPOINTS,
  acceptLocalRisk,
  configProblems,
  hasAcceptedLocal,
  isLocalApiRoot,
  providerNeedsKey,
  withProvider,
  type KeyValueStore,
} from "./config";
import { openAiCompatibleRoot, openAiRequest } from "./providers";
import type { AiConfig } from "./types";

function memoryStore(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function baseConfig(): AiConfig {
  return {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "",
    hasKey: true,
    baseUrl: PROVIDER_ENDPOINTS.deepseek,
    maxTokens: 2048,
    temperature: null,
    useMaxCompletionTokens: false,
    rememberKey: true,
  };
}

describe("§9.5.12 proveedor local", () => {
  it("withProvider → local fija baseUrl Ollama y no exige clave", () => {
    const next = withProvider(baseConfig(), "local");
    expect(next.provider).toBe("local");
    expect(next.baseUrl).toBe("http://127.0.0.1:11434");
    expect(next.apiKey).toBe("");
    expect(next.hasKey).toBe(false);
    expect(next.rememberKey).toBe(false);
    expect(providerNeedsKey("local")).toBe(false);
    expect(providerNeedsKey("deepseek")).toBe(true);
  });

  it("isLocalApiRoot sólo localhost / 127.0.0.1 por http", () => {
    expect(isLocalApiRoot("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalApiRoot("http://localhost:11434/v1")).toBe(true);
    expect(isLocalApiRoot("https://127.0.0.1:11434")).toBe(false);
    expect(isLocalApiRoot("http://evil.example")).toBe(false);
  });

  it("confirmación local se persiste sin secretos", () => {
    const store = memoryStore();
    expect(hasAcceptedLocal(store)).toBe(false);
    expect(acceptLocalRisk(store)).toBe(true);
    expect(hasAcceptedLocal(store)).toBe(true);
    expect(store.getItem(LOCAL_ACCEPTED_KEY)).toBe("1");
    expect(LOCAL_CONFIRM_MESSAGE.toLowerCase()).toContain("http");
    expect(LOCAL_CONFIRM_MESSAGE).toMatch(/8\s*GB/i);
  });

  it("configProblems local: sin clave; exige aceptación y raíz local", () => {
    const store = memoryStore();
    acceptLocalRisk(store);
    const cfg: AiConfig = {
      ...withProvider(baseConfig(), "local"),
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
    };
    // hasAcceptedLocal() usa defaultStore; inyectamos vía setItem en window si existe.
    try {
      window.localStorage.setItem(LOCAL_ACCEPTED_KEY, "1");
    } catch {
      // jsdom
    }
    const problems = configProblems(cfg, []);
    expect(problems.some((p) => /clave/i.test(p))).toBe(false);
    const badRoot = configProblems({ ...cfg, baseUrl: "https://api.openai.com/v1" }, []);
    expect(badRoot.some((p) => /localhost|127\.0\.0\.1/i.test(p))).toBe(true);
  });

  it("openAiCompatibleRoot añade /v1 a la raíz Ollama bare", () => {
    expect(openAiCompatibleRoot("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/v1");
    const req = openAiRequest(
      { ...withProvider(baseConfig(), "local"), model: "llama3.2" },
      [{ role: "user", text: "hola", images: [] }],
      "sys",
      false,
    );
    expect(req.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
  });
});

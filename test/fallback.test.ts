import { describe, expect, it, vi } from "vitest";
import { analyzeItem } from "../src/gemini.ts";
import type { NewsItem } from "../src/types.ts";
import { DEFAULT_WORKERS_AI_MODEL, MODEL_CALL_TIMEOUT_MS, type WorkersAiRunOptions } from "../src/workers-ai.ts";

const item: NewsItem = {
  id: "fed:1",
  source: "Federal Reserve",
  category: "central-banks",
  title: "Fed holds rates",
  link: "https://example.com/fed",
  summary: "The committee left the target range unchanged.",
  publishedAt: Date.parse("2026-10-21T15:00:00Z"),
};

const hebrewJson = JSON.stringify({
  importance: 5,
  category: "central-banks",
  headline: "הפד השאיר את הריבית ללא שינוי",
  summary: "הבנק המרכזי לא שינה את הריבית. ההחלטה הגיעה אחרי נתוני אינפלציה מתונים. אין כאן שינוי במדיניות.",
  marketMeaning: "ריבית ללא שינוי משאירה את עלות האשראי קרובה לרמה הנוכחית.",
  affects: ["משכנתאות", "הלוואות", "ריבית על פיקדונות", "שער הדולר"],
});

function geminiResponse(status: number, body = "no"): Response {
  if (status === 200) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: hebrewJson }] } }] }), { status: 200 });
  }
  return new Response(body, { status });
}

describe("model fallback", () => {
  it("uses the primary Gemini model and does not call Workers AI", async () => {
    let aiCalls = 0;
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      ai: {
        run: async () => {
          aiCalls += 1;
          return { response: hebrewJson };
        },
      },
      fetchImpl: async (input) => {
        expect(String(input)).toContain("gemini-primary");
        return geminiResponse(200);
      },
    });
    expect(result).toMatchObject({ ok: true, model: "gemini-primary" });
    expect(aiCalls).toBe(0);
  });

  it("tries the Gemini fallback after a 429 and skips Workers AI when that call succeeds", async () => {
    const models: string[] = [];
    let aiCalls = 0;
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      ai: {
        run: async () => {
          aiCalls += 1;
          return { response: hebrewJson };
        },
      },
      fetchImpl: async (input) => {
        const url = String(input);
        const model = url.includes("gemini-fallback") ? "gemini-fallback" : "gemini-primary";
        models.push(model);
        return geminiResponse(model === "gemini-primary" ? 429 : 200);
      },
    });
    expect(models).toEqual(["gemini-primary", "gemini-fallback"]);
    expect(result).toMatchObject({ ok: true, model: "gemini-fallback" });
    expect(aiCalls).toBe(0);
  });

  it("calls Workers AI only after both Gemini calls fail, and keeps an invalid reply unseen", async () => {
    const models: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      ai: {
        run: async (model) => {
          models.push(model);
          return { response: "not hebrew and not json" };
        },
      },
      fetchImpl: async (input) => {
        const url = String(input);
        models.push(url.includes("gemini-fallback") ? "gemini-fallback" : "gemini-primary");
        const timeout = new Error("timed out");
        timeout.name = "TimeoutError";
        throw timeout;
      },
    });
    expect(models).toEqual(["gemini-primary", "gemini-fallback", DEFAULT_WORKERS_AI_MODEL]);
    expect(result).toEqual({ ok: false, remember: false, reason: "rejected" });
  });

  it("asks Gemini again when the draft is not Hebrew, then accepts Gemini lite", async () => {
    const calls: string[] = [];
    let aiCalls = 0;
    const english = JSON.stringify({
      importance: 5,
      category: "central-banks",
      headline: "Fed holds rates steady",
      summary: "The committee left the target range unchanged after the latest inflation data. No policy change was announced.",
      marketMeaning: "Borrowing costs stay near the current level.",
      affects: ["mortgages", "loans", "deposit rates"],
      glossary: [],
    });
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-3.8-flash",
      fallbackModel: "gemini-3.5-flash-lite",
      ai: {
        run: async () => {
          aiCalls += 1;
          return { response: hebrewJson };
        },
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? init.body : "";
        const model = url.includes("gemini-3.5-flash-lite") ? "gemini-lite" : "gemini-primary";
        calls.push(body.includes("הניסיון הקודם") ? `${model}:remind` : model);
        const text = model === "gemini-lite" ? hebrewJson : english;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
      },
    });
    expect(calls).toEqual(["gemini-primary", "gemini-primary:remind", "gemini-lite:remind"]);
    expect(result).toMatchObject({
      ok: true,
      model: "gemini-3.5-flash-lite",
      analysis: { headline: "הפד השאיר את הריבית ללא שינוי" },
    });
    expect(aiCalls).toBe(0);
  });

  it("accepts a Hebrew Workers AI reply after both Gemini calls are rate limited", async () => {
    const models: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-3.8-flash",
      fallbackModel: "gemini-3.5-flash-lite",
      workersAiModel: DEFAULT_WORKERS_AI_MODEL,
      ai: {
        run: async (model, inputs) => {
          models.push(model);
          expect(inputs.max_tokens).toBe(2048);
          expect(inputs.messages.map((message) => message.role)).toEqual(["system", "user"]);
          expect(inputs.messages[1]?.content).toContain("הניסיון הקודם");
          return { response: JSON.parse(hebrewJson) as unknown };
        },
      },
      fetchImpl: async (input) => {
        const url = String(input);
        models.push(url.includes("gemini-3.5-flash-lite") ? "gemini-lite" : "gemini-primary");
        return geminiResponse(429, "slow down");
      },
    });
    expect(models).toEqual(["gemini-primary", "gemini-lite", DEFAULT_WORKERS_AI_MODEL]);
    expect(result).toMatchObject({ ok: true, model: DEFAULT_WORKERS_AI_MODEL });
  });

  it("stops the chain when Workers AI is not bound and both Gemini calls return 429", async () => {
    const models: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input) => {
        const url = String(input);
        models.push(url.includes("gemini-fallback") ? "gemini-fallback" : "gemini-primary");
        return geminiResponse(429, "slow down");
      },
    });
    expect(models).toEqual(["gemini-primary", "gemini-fallback"]);
    expect(result).toEqual({ ok: false, remember: false, reason: "rate_limited" });
  });

  it("does not call Workers AI on a Gemini auth failure", async () => {
    let aiCalls = 0;
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      ai: {
        run: async () => {
          aiCalls += 1;
          return { response: hebrewJson };
        },
      },
      fetchImpl: async () => geminiResponse(401, "bad key"),
    });
    expect(result).toEqual({ ok: false, remember: false, reason: "auth" });
    expect(aiCalls).toBe(0);
  });

  it("calls fetch as a function so a stub that rejects a receiver does not throw", async () => {
    let calls = 0;
    const fetchImpl = function (this: unknown, input: RequestInfo | URL): Promise<Response> {
      if (this != null) throw new TypeError("Illegal invocation");
      calls += 1;
      expect(String(input)).toContain("gemini-primary");
      return Promise.resolve(geminiResponse(200));
    };
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ ok: true, model: "gemini-primary" });
  });

  it("binds the default fetch to globalThis", async () => {
    const original = globalThis.fetch;
    let receiver: unknown = "missing";
    globalThis.fetch = function (this: unknown): Promise<Response> {
      receiver = this;
      return Promise.resolve(geminiResponse(200));
    } as typeof fetch;
    try {
      const result = await analyzeItem({
        item,
        categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
        apiKey: "key",
        model: "gemini-primary",
        fallbackModel: "gemini-fallback",
      });
      expect(result).toMatchObject({ ok: true, model: "gemini-primary" });
    } finally {
      globalThis.fetch = original;
    }
    expect(receiver).toBe(globalThis);
  });

  it("logs the Gemini error and redacts the API key", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    const apiKey = "unit-test-gemini-marker";
    try {
      await analyzeItem({
        item,
        categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
        apiKey,
        model: "gemini-primary",
        fallbackModel: "gemini-fallback",
        fetchImpl: async () => {
          throw new Error(`network down ${apiKey}`);
        },
      });
    } finally {
      spy.mockRestore();
    }
    const logged = lines.join("\n");
    expect(logged).toContain("gemini_failed");
    expect(logged).toContain("network down");
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain(apiKey);
  });

  it("retries the same model with a stricter instruction when Arabic script appears", async () => {
    const calls: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        calls.push(promptTag(input, init));
        const text = calls.length === 1 ? storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`) : hebrewJson;
        return jsonText(text);
      },
    });
    expect(calls).toEqual(["primary:base", "primary:strict"]);
    expect(result).toMatchObject({
      ok: true,
      model: "gemini-primary",
      analysis: { headline: "הפד השאיר את הריבית ללא שינוי" },
    });
  });

  it("asks the fallback model after the strict retry, then strips Arabic words", async () => {
    const calls: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        calls.push(promptTag(input, init));
        return jsonText(storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`));
      },
    });
    expect(calls).toEqual(["primary:base", "primary:strict", "fallback:strict"]);
    expect(result).toMatchObject({
      ok: true,
      model: "gemini-fallback",
      analysis: { headline: "הבנק הוריד את הריבית ברבע נקודה" },
    });
    expect(JSON.stringify(result)).not.toMatch(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/);
  });

  it("strips the last Hebrew draft when the fallback call fails after Arabic", async () => {
    const calls: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        const tag = promptTag(input, init);
        calls.push(tag);
        if (tag === "fallback:strict") return geminiResponse(500, "down");
        return jsonText(storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`));
      },
    });
    expect(calls).toEqual(["primary:base", "primary:strict", "fallback:strict"]);
    expect(result).toMatchObject({
      ok: true,
      model: "gemini-primary",
      analysis: { headline: "הבנק הוריד את הריבית ברבע נקודה" },
    });
  });

  it("rejects a draft that is no longer Hebrew after Arabic words are removed", async () => {
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async () => jsonText(storyJson(`הפדהוריד${ARABIC_WORD}`)),
    });
    expect(result).toEqual({ ok: false, remember: true, reason: "rejected" });
  });

  it("stops the Arabic retry when the same model returns an auth error", async () => {
    const calls: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        const tag = promptTag(input, init);
        calls.push(tag);
        if (tag === "primary:strict") return geminiResponse(401, "bad key");
        return jsonText(storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`));
      },
    });
    expect(calls).toEqual(["primary:base", "primary:strict"]);
    expect(result).toEqual({ ok: false, remember: false, reason: "auth" });
  });

  it("stops when the fallback model returns an auth error during an Arabic retry", async () => {
    const calls: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        const tag = promptTag(input, init);
        calls.push(tag);
        if (tag === "fallback:strict") return geminiResponse(403, "forbidden");
        return jsonText(storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`));
      },
    });
    expect(calls).toEqual(["primary:base", "primary:strict", "fallback:strict"]);
    expect(result).toEqual({ ok: false, remember: false, reason: "auth" });
  });

  it("uses a clean fallback draft when the strict retry on the first model is still mixed", async () => {
    const calls: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        const tag = promptTag(input, init);
        calls.push(tag);
        const text = tag === "fallback:strict" ? hebrewJson : storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`);
        return jsonText(text);
      },
    });
    expect(calls).toEqual(["primary:base", "primary:strict", "fallback:strict"]);
    expect(result).toMatchObject({ ok: true, model: "gemini-fallback" });
  });

  it("retries the Gemini fallback model when it is the one that mixed in Arabic", async () => {
    const calls: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        const tag = promptTag(input, init);
        calls.push(tag);
        if (tag === "primary:base") return geminiResponse(429, "slow down");
        const text = tag === "fallback:strict" ? hebrewJson : storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`);
        return jsonText(text);
      },
    });
    expect(calls).toEqual(["primary:base", "fallback:base", "fallback:strict"]);
    expect(result).toMatchObject({ ok: true, model: "gemini-fallback" });
  });

  it("asks again with the stricter instruction when a Hebrew retry comes back in Arabic script", async () => {
    const calls: string[] = [];
    const english = JSON.stringify({
      importance: 5,
      category: "central-banks",
      headline: "Fed holds rates steady",
      summary: "The committee left the target range unchanged after the latest inflation data. No policy change was announced.",
      marketMeaning: "Borrowing costs stay near the current level.",
      affects: ["mortgages", "loans", "deposit rates"],
    });
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        const tag = promptTag(input, init);
        calls.push(tag);
        if (tag === "primary:remind") return jsonText(storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`));
        if (tag === "primary:base") return jsonText(english);
        return jsonText(hebrewJson);
      },
    });
    expect(calls).toEqual(["primary:base", "primary:remind", "primary:strict"]);
    expect(result).toMatchObject({ ok: true, model: "gemini-primary" });
  });

  it("retries Workers AI once when its reply contains Arabic script", async () => {
    const users: string[] = [];
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      ai: {
        run: async (_model, inputs) => {
          users.push(inputs.messages[1]?.content ?? "");
          return { response: users.length === 1 ? storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`) : hebrewJson };
        },
      },
      fetchImpl: async () => geminiResponse(429, "slow down"),
    });
    expect(users).toHaveLength(2);
    expect(users[1]).toContain("The previous draft contained Arabic script");
    expect(result).toMatchObject({ ok: true, model: DEFAULT_WORKERS_AI_MODEL });
  });

  it("strict-retries the fallback model when its Hebrew reminder comes back with Arabic script", async () => {
    const calls: string[] = [];
    const english = JSON.stringify({
      importance: 5,
      category: "central-banks",
      headline: "Fed holds rates steady",
      summary: "The committee left the target range unchanged after the latest inflation data. No policy change was announced.",
      marketMeaning: "Borrowing costs stay near the current level.",
      affects: ["mortgages", "loans", "deposit rates"],
    });
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        const tag = promptTag(input, init);
        calls.push(tag);
        if (tag === "primary:base") return geminiResponse(429, "slow down");
        if (tag === "fallback:base") return jsonText(english);
        if (tag === "fallback:strict") return jsonText(hebrewJson);
        return jsonText(storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`));
      },
    });
    expect(calls).toEqual(["primary:base", "fallback:base", "fallback:remind", "fallback:strict"]);
    expect(result).toMatchObject({ ok: true, model: "gemini-fallback" });
  });

  it("strict-retries the fallback after an English draft when that fallback mixes Arabic", async () => {
    const calls: string[] = [];
    const english = JSON.stringify({
      importance: 5,
      category: "central-banks",
      headline: "Fed holds rates steady",
      summary: "The committee left the target range unchanged after the latest inflation data. No policy change was announced.",
      marketMeaning: "Borrowing costs stay near the current level.",
      affects: ["mortgages", "loans", "deposit rates"],
    });
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      fetchImpl: async (input, init) => {
        const tag = promptTag(input, init);
        calls.push(tag);
        if (tag === "fallback:remind") return jsonText(storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`));
        if (tag === "fallback:strict") return jsonText(hebrewJson);
        return jsonText(english);
      },
    });
    expect(calls).toEqual(["primary:base", "primary:remind", "fallback:remind", "fallback:strict"]);
    expect(result).toMatchObject({ ok: true, model: "gemini-fallback" });
  });

  it("strips the second Workers AI draft when it still contains Arabic script", async () => {
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      ai: {
        run: async () => ({ response: storyJson(`מניות ${ARABIC_WORD} נסגרו בירידות חדות היום`) }),
      },
      fetchImpl: async () => geminiResponse(429, "slow down"),
    });
    expect(result).toMatchObject({
      ok: true,
      model: DEFAULT_WORKERS_AI_MODEL,
      analysis: { headline: "מניות נסגרו בירידות חדות היום" },
    });
  });

  it("strips Arabic words when a Workers AI retry still mixes scripts", async () => {
    let calls = 0;
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      ai: {
        run: async () => {
          calls += 1;
          if (calls > 1) throw new Error("llama down");
          return { response: storyJson(`הבנק ${ARABIC_WORD} הוריד את הריבית ברבע נקודה`) };
        },
      },
      fetchImpl: async () => geminiResponse(429, "slow down"),
    });
    expect(calls).toBe(2);
    expect(result).toMatchObject({
      ok: true,
      model: DEFAULT_WORKERS_AI_MODEL,
      analysis: { headline: "הבנק הוריד את הריבית ברבע נקודה" },
    });
  });

  it("aborts each hung Gemini call and the Workers AI call", async () => {
    expect(MODEL_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(MODEL_CALL_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
    const signals: AbortSignal[] = [];
    const hang = (signal: AbortSignal | undefined): Promise<never> =>
      new Promise((_resolve, reject) => {
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        signals.push(signal);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const result = await analyzeItem({
      item,
      categories: [{ id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" }],
      apiKey: "key",
      model: "gemini-primary",
      fallbackModel: "gemini-fallback",
      timeoutMs: 40,
      ai: {
        run: (_model, _inputs, options?: WorkersAiRunOptions) => hang(options?.signal),
      },
      fetchImpl: async (_input, init) => hang(init?.signal ?? undefined),
    });
    expect(result).toEqual({ ok: false, remember: false, reason: "transport" });
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(signals.every((signal) => signal.reason instanceof Error && signal.reason.name === "TimeoutError")).toBe(true);
  });
});

const ARABIC_WORD = "المركزي";

function storyJson(headline: string): string {
  return JSON.stringify({
    importance: 5,
    category: "central-banks",
    headline,
    summary: "הבנק המרכזי לא שינה את הריבית. ההחלטה הגיעה אחרי נתוני אינפלציה מתונים. אין כאן שינוי במדיניות.",
    marketMeaning: "ריבית ללא שינוי משאירה את עלות האשראי קרובה לרמה הנוכחית.",
    affects: ["משכנתאות", "הלוואות", "ריבית על פיקדונות", "שער הדולר"],
  });
}

function jsonText(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
}

function promptTag(input: RequestInfo | URL, init?: RequestInit): string {
  const url = String(input);
  const body = typeof init?.body === "string" ? init.body : "";
  const model = url.includes("gemini-fallback") ? "fallback" : "primary";
  const mode = body.includes("The previous draft contained Arabic script")
    ? "strict"
    : body.includes("הניסיון הקודם לא היה בעברית")
      ? "remind"
      : "base";
  return `${model}:${mode}`;
}

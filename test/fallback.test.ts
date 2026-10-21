import { describe, expect, it } from "vitest";
import { analyzeItem } from "../src/gemini.ts";
import type { NewsItem } from "../src/types.ts";
import { DEFAULT_WORKERS_AI_MODEL } from "../src/workers-ai.ts";

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
});

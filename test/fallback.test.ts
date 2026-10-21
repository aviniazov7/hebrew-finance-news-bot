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
  glossary: [],
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

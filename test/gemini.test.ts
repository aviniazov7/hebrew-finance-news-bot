import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../src/catalog.ts";
import { buildSystemInstruction, buildUserPrompt, HEBREW_RETRY_NOTE, parseAnalysis } from "../src/gemini.ts";
import type { NewsItem } from "../src/types.ts";

const item: NewsItem = {
  id: "fed:1",
  source: "Federal Reserve",
  category: "central-banks",
  title: "Fed lowers rates",
  link: "https://example.com/fed",
  summary: "The committee lowered the target range.",
  publishedAt: Date.parse("2026-10-21T18:00:00Z"),
};

describe("Gemini parsing", () => {
  it("asks for Hebrew and for balanced scoring across markets", () => {
    const system = buildSystemInstruction(DEFAULT_CATEGORIES);
    expect(system).toContain("simple Hebrew");
    expect(system).toContain("Do not favor crypto");
    expect(system).toContain("not automatically more important");
    expect(system).toContain("central-banks");
    expect(system).toContain("israel");
    expect(system).toContain("affects is 3 to 6 short Hebrew noun phrases");
    expect(system).toContain("משכנתאות, הלוואות, ריבית על פיקדונות");
    const reminded = buildUserPrompt(item, true);
    expect(reminded).toContain(HEBREW_RETRY_NOTE);
    expect(reminded).toContain("Feed category hint: central-banks");
    expect(buildUserPrompt(item, false)).not.toContain(HEBREW_RETRY_NOTE);
  });

  it("parses fenced JSON and ignores a bad score", () => {
    const parsed = parseAnalysis(
      "```json\n" +
        JSON.stringify({
          importance: "4",
          category: "Macro",
          headline: "כותרת",
          summary: "סיכום",
          marketMeaning: "השפעה",
          affects: ["משכנתאות, הלוואות", "ריבית על פיקדונות", 4, "מניות צמיחה וטק"],
          glossary: [{ term: "CPI", hebrew: "מדד", explanation: "הסבר" }, { term: 1 }],
        }) +
        "\n```",
    );
    expect(parsed).toMatchObject({
      importance: 4,
      category: "macro",
      headline: "כותרת",
      affects: ["משכנתאות, הלוואות", "ריבית על פיקדונות", "מניות צמיחה וטק"],
      glossary: [{ term: "CPI", hebrew: "מדד", explanation: "הסבר" }],
    });
    expect(parseAnalysis('{"importance":4,"headline":"כותרת","summary":"סיכום","marketMeaning":"השפעה"}')?.affects).toEqual(
      [],
    );
    expect(parseAnalysis('{"importance":9,"headline":"x","summary":"y","marketMeaning":"z"}')).toBeNull();
    expect(parseAnalysis("not json")).toBeNull();
  });
});

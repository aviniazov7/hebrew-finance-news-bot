import { describe, expect, it } from "vitest";
import { FALLBACK_AFFECTS } from "../src/affects.ts";
import {
  containsArabicScript,
  containsInvestmentAdvice,
  isPrimarilyHebrew,
  resolveAffects,
  sanitizeAnalysis,
  stripArabicFromAnalysis,
  stripOffendingWords,
} from "../src/hebrew.ts";
import type { Analysis } from "../src/types.ts";

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    importance: 4,
    category: "macro",
    headline: "מדד המחירים לצרכן עלה פחות מהצפוי",
    summary: "המדד עלה לאט יותר מהתחזית. גם הליבה התקררה. שוק העבודה לא השתנה בהודעה הזו.",
    marketMeaning: "הפתעה כזו בדרך כלל מורידה ציפיות להעלאת ריבית ומזיזה אג״ח ומניות.",
    affects: ["ציפיות לריבית", "אג״ח ממשלתיות", "מדדי מניות", "שער הדולר"],
    ...overrides,
  };
}

describe("Hebrew check", () => {
  it("accepts everyday Hebrew and Hebrew with a short ticker", () => {
    expect(isPrimarilyHebrew("הפד הוריד את הריבית ברבע נקודת אחוז")).toBe(true);
    expect(isPrimarilyHebrew("JPMorgan מזהירה מהפסדי אשראי בכרטיסי אשראי")).toBe(true);
  });

  it("rejects English and very short fragments", () => {
    expect(isPrimarilyHebrew("Fed cuts rates and stocks jump")).toBe(false);
    expect(isPrimarilyHebrew("הפד")).toBe(false);
  });

  it("rejects investment-advice wording", () => {
    expect(containsInvestmentAdvice("כדאי לקנות מניות עכשיו")).toBe(true);
    expect(containsInvestmentAdvice("You should buy the dip")).toBe(true);
    expect(containsInvestmentAdvice("למידע בלבד. אין כאן המלצה לפעולה בשוק.")).toBe(false);
  });

  it("keeps a Hebrew story and returns the cleaned affects list", () => {
    const clean = sanitizeAnalysis(analysis());
    expect(clean?.headline).toBe("מדד המחירים לצרכן עלה פחות מהצפוי");
    expect(clean?.affects).toEqual(["ציפיות לריבית", "אג״ח ממשלתיות", "מדדי מניות", "שער הדולר"]);
  });

  it("rejects a draft that is not Hebrew or that gives advice", () => {
    expect(sanitizeAnalysis(analysis({ headline: "Fed cuts rates again today" }))).toBeNull();
    expect(sanitizeAnalysis(analysis({ marketMeaning: "כדאי לקנות מניות כי הריבית ירדה והשוק יעלה עכשיו." }))).toBeNull();
  });

  it("keeps three to six Hebrew affects and drops English, advice, and extras", () => {
    const clean = sanitizeAnalysis(
      analysis({
        affects: [
          "🎯 על מה זה משפיע: משכנתאות, הלוואות",
          "Buy the dip",
          "כדאי לקנות מניות",
          "ריבית על פיקדונות",
          "מניות צמיחה וטק",
          "שער הדולר-שקל",
          "קריפטו",
          "פיקדונות",
        ],
      }),
    );
    expect(clean?.affects).toEqual([
      "משכנתאות",
      "הלוואות",
      "ריבית על פיקדונות",
      "מניות צמיחה וטק",
      "שער הדולר-שקל",
      "קריפטו",
    ]);
  });

  it("rejects Arabic script blocks and allows Hebrew, Latin, digits, and nearby scripts", () => {
    const hebrew = "הפד הוריד את הריבית ברבע נקודת אחוז";
    expect(containsArabicScript(hebrew)).toBe(false);
    expect(containsArabicScript(`${hebrew} AAPL 1.5`)).toBe(false);
    expect(containsArabicScript("ܐܠܦ")).toBe(false);
    expect(containsArabicScript("\u089F")).toBe(false);
    for (const code of [0x0600, 0x0627, 0x06ff, 0x0750, 0x077f, 0x08a0, 0x08ff, 0xfb50, 0xfdff, 0xfe70, 0xfeff]) {
      expect(containsArabicScript(`${hebrew}${String.fromCodePoint(code)}`)).toBe(true);
    }
  });

  it("strips Arabic words and leftover Arabic characters, and keeps tickers and numbers", () => {
    expect(stripOffendingWords("הבנק المركزي הוריד את הריבית")).toBe("הבנק הוריד את הריבית");
    expect(stripOffendingWords("מניות أبل (AAPL) עלו ב־2%")).toBe("מניות (AAPL) עלו ב־2%");
    expect(stripOffendingWords("שלום، עולם")).toBe("שלום עולם");
    expect(stripOffendingWords("\uFEFFהפד הוריד את הריבית")).toBe("הפד הוריד את הריבית");
    expect(stripOffendingWords("מניית AAPL עלתה ב־3%")).toBe("מניית AAPL עלתה ב־3%");
    expect(containsArabicScript(stripOffendingWords("הודעה \uFB50 על השוק"))).toBe(false);
  });

  it("keeps a Hebrew draft that mixes in an Arabic word so the caller can retry before stripping", () => {
    const mixed = analysis({
      headline: "הבנק المركزي הוריד את הריבית ברבע נקודה",
      affects: ["משכנתאות", "البنك", "הלוואות"],
    });
    expect(containsArabicScript(mixed.headline)).toBe(true);
    expect(sanitizeAnalysis(mixed)?.headline).toContain("المركزي");
    const stripped = stripArabicFromAnalysis(mixed);
    expect(stripped.headline).toBe("הבנק הוריד את הריבית ברבע נקודה");
    expect(stripped.affects).toEqual(["משכנתאות", "הלוואות"]);
    expect(containsArabicScript(`${stripped.headline}\n${stripped.affects.join(" ")}`)).toBe(false);
  });

  it("leaves a missing affects list empty so the category fallback can fill it", () => {
    const clean = sanitizeAnalysis(analysis({ affects: ["Fed funds rate", "yields"] }));
    expect(clean?.affects).toEqual([]);
    expect(resolveAffects(clean?.affects, "central-banks")).toEqual([...FALLBACK_AFFECTS["central-banks"]!]);
    expect(resolveAffects(["משכנתאות", "הלוואות"], "stocks")).toEqual([...FALLBACK_AFFECTS.stocks!]);
  });
});

import { describe, expect, it } from "vitest";
import { containsInvestmentAdvice, isPrimarilyHebrew, sanitizeAnalysis } from "../src/hebrew.ts";
import type { Analysis } from "../src/types.ts";

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    importance: 4,
    category: "macro",
    headline: "מדד המחירים לצרכן עלה פחות מהצפוי",
    summary: "המדד עלה לאט יותר מהתחזית. גם הליבה התקררה. שוק העבודה לא השתנה בהודעה הזו.",
    marketMeaning: "הפתעה כזו בדרך כלל מורידה ציפיות להעלאת ריבית ומזיזה אג״ח ומניות.",
    glossary: [],
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

  it("drops an English glossary line but keeps a Hebrew story", () => {
    const clean = sanitizeAnalysis(
      analysis({
        glossary: [
          { term: "CPI", hebrew: "CPI", explanation: "Consumer price index for households." },
          {
            term: "CPI",
            hebrew: "מדד המחירים לצרכן",
            explanation: "מדד שמראה בכמה התייקרו הקניות של משק בית רגיל.",
          },
        ],
      }),
    );
    expect(clean?.glossary).toHaveLength(1);
    expect(clean?.glossary[0]?.hebrew).toBe("מדד המחירים לצרכן");
  });

  it("rejects a draft that is not Hebrew or that gives advice", () => {
    expect(sanitizeAnalysis(analysis({ headline: "Fed cuts rates again today" }))).toBeNull();
    expect(sanitizeAnalysis(analysis({ marketMeaning: "כדאי לקנות מניות כי הריבית ירדה והשוק יעלה עכשיו." }))).toBeNull();
  });
});

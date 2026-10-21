import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../src/catalog.ts";
import { DEFAULT_DISCLAIMER } from "../src/config.ts";
import { formatTelegramMessage } from "../src/format.ts";
import { containsInvestmentAdvice, isPrimarilyHebrew } from "../src/hebrew.ts";
import { renderSamples } from "../src/samples.ts";

const stocks = DEFAULT_CATEGORIES.find((category) => category.id === "stocks");
if (!stocks) throw new Error("missing stocks category");

describe("formatTelegramMessage", () => {
  it("renders the category tag, market line, glossary, source, and disclaimer", () => {
    const text = formatTelegramMessage({
      category: stocks,
      headline: "וול סטריט נסגרה בירידות",
      summary: "המדדים ירדו. מניות השבבים הובילו את הירידה. לא הייתה עצירת מסחר.",
      marketMeaning: "מה זה אומר לשוק: יום כזה מגדיל תנודות במדדים.",
      glossary: [
        { term: "hedge fund", hebrew: "קרן גידור", explanation: "קרן שמנהלת כסף של לקוחות עשירים." },
        { term: "CPI", hebrew: "מדד המחירים לצרכן", explanation: "מדד שמראה בכמה התייקרו הקניות." },
        { term: "ETF", hebrew: "קרן סל", explanation: "מוצר שנסחר כמו מניה." },
      ],
      sourceName: "CNBC",
      sourceUrl: "https://example.com/story",
      disclaimer: DEFAULT_DISCLAIMER,
    });
    expect(text.startsWith("📈 מניות · וול סטריט נסגרה בירידות")).toBe(true);
    expect(text).toContain("מה זה אומר לשוק: יום כזה מגדיל תנודות במדדים.");
    expect(text).toContain("מילון: קרן גידור (hedge fund) — קרן שמנהלת כסף של לקוחות עשירים.; מדד המחירים לצרכן (CPI)");
    expect(text).not.toContain("קרן סל");
    expect(text).toContain("מקור: CNBC — https://example.com/story");
    expect(text).toContain(DEFAULT_DISCLAIMER);
  });

  it("omits the glossary line when there are no terms", () => {
    const text = formatTelegramMessage({
      category: stocks,
      headline: "כותרת בעברית פשוטה לדוגמה",
      summary: "משפט ראשון. משפט שני על השוק.",
      marketMeaning: "השוק יכול לזוז בשני הכיוונים אחרי הודעה כזו.",
      sourceName: "CNBC",
      sourceUrl: "https://example.com/story",
    });
    expect(text).not.toContain("מילון:");
  });

  it("uses a custom category and refuses a non-http source link as a bare url", () => {
    const text = formatTelegramMessage({
      category: { id: "private-credit", emoji: "🏦", labelHe: "אשראי פרטי", labelEn: "Private credit" },
      headline: "קרנות אשראי פרטי גייסו פחות כסף",
      summary: "הגיוס ברבעון ירד. מנהלי הקרנות דיברו על לווים זהירים יותר.",
      marketMeaning: "גיוס חלש יותר יכול לייקר אשראי לחברות בינוניות.",
      sourceName: "Example",
      sourceUrl: "javascript:alert(1)",
      disclaimer: "",
    });
    expect(text.startsWith("🏦 אשראי פרטי · קרנות אשראי פרטי גייסו פחות כסף")).toBe(true);
    expect(text).not.toContain("javascript:");
    expect(text).not.toContain(DEFAULT_DISCLAIMER);
  });

  it("keeps a very long message inside Telegram's limit", () => {
    const text = formatTelegramMessage({
      category: stocks,
      headline: "כותרת",
      summary: "משפט. ".repeat(800),
      marketMeaning: "השוק זז. ".repeat(200),
      glossary: [{ term: "CPI", hebrew: "מדד", explanation: "הסבר. ".repeat(100) }],
      sourceName: "CNBC",
      sourceUrl: "https://example.com/long",
      disclaimer: DEFAULT_DISCLAIMER,
    });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain("מקור: CNBC — https://example.com/long");
  });
});

describe("fixture samples", () => {
  const samples = renderSamples();

  it("includes one Hebrew message for every default category", () => {
    expect(samples.map((sample) => sample.categoryId)).toEqual(DEFAULT_CATEGORIES.map((category) => category.id));
    for (const sample of samples) {
      const category = DEFAULT_CATEGORIES.find((item) => item.id === sample.categoryId);
      expect(category).toBeTruthy();
      expect(sample.text.startsWith(`${category?.emoji} ${category?.labelHe} ·`)).toBe(true);
      expect(sample.text).toContain("מה זה אומר לשוק:");
      expect(sample.text).toContain("מילון:");
      expect(sample.text).toContain("מקור:");
      expect(sample.text).toContain(DEFAULT_DISCLAIMER);
      const [headline = "", , summary = "", , market = ""] = sample.text.split("\n");
      expect(isPrimarilyHebrew(headline.replace(/^.*·\s*/, ""))).toBe(true);
      expect(isPrimarilyHebrew(summary)).toBe(true);
      expect(isPrimarilyHebrew(market.replace(/^מה זה אומר לשוק:\s*/, ""))).toBe(true);
      expect(containsInvestmentAdvice(sample.text)).toBe(false);
    }
  });

  it("is copied into the README", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("Fixture samples");
    for (const sample of samples) {
      const headline = sample.text.split("\n")[0] ?? "";
      expect(readme).toContain(headline);
    }
  });
});

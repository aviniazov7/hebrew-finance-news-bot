import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FALLBACK_AFFECTS, GENERIC_AFFECTS } from "../src/affects.ts";
import { DEFAULT_CATEGORIES } from "../src/catalog.ts";
import { DEFAULT_DISCLAIMER } from "../src/config.ts";
import { formatTelegramMessage } from "../src/format.ts";
import { toHashtags } from "../src/hashtags.ts";
import { containsInvestmentAdvice, isPrimarilyHebrew } from "../src/hebrew.ts";
import { renderSamples } from "../src/samples.ts";

const stocks = DEFAULT_CATEGORIES.find((category) => category.id === "stocks");
if (!stocks) throw new Error("missing stocks category");

describe("formatTelegramMessage", () => {
  it("renders hashtags, a linked source credit on the summary, and the disclaimer", () => {
    const text = formatTelegramMessage({
      category: stocks,
      headline: "וול סטריט נסגרה בירידות",
      summary: "המדדים ירדו. מניות השבבים הובילו את הירידה. לא הייתה עצירת מסחר.",
      marketMeaning: "מה זה אומר לשוק: יום כזה מגדיל תנודות במדדים.",
      affects: ["מדדי המניות", "מניות שבבים", 'אג"ח חברות'],
      sourceName: "CNBC Tech",
      sourceUrl: "https://example.com/story",
      disclaimer: DEFAULT_DISCLAIMER,
    });
    expect(text.startsWith("📈 מניות · וול סטריט נסגרה בירידות")).toBe(true);
    expect(text).toContain(
      'המדדים ירדו. מניות השבבים הובילו את הירידה. לא הייתה עצירת מסחר. — <a href="https://example.com/story">CNBC</a>',
    );
    expect(text).toContain("מה זה אומר לשוק: יום כזה מגדיל תנודות במדדים.");
    const marketAt = text.indexOf("מה זה אומר לשוק:");
    const affectsAt = text.indexOf("🎯 על מה זה משפיע: #מדדי_המניות #מניות_שבבים #אג״ח_חברות");
    expect(marketAt).toBeGreaterThanOrEqual(0);
    expect(affectsAt).toBeGreaterThan(marketAt);
    expect(text).not.toContain("מילון:");
    expect(text).not.toContain("מקור:");
    expect(text).not.toContain("CNBC Tech");
    expect(text.endsWith(DEFAULT_DISCLAIMER)).toBe(true);
  });

  it("uses category fallback hashtags when the model list is missing", () => {
    const text = formatTelegramMessage({
      category: stocks,
      headline: "כותרת בעברית פשוטה לדוגמה",
      summary: "משפט ראשון. משפט שני על השוק.",
      marketMeaning: "השוק יכול לזוז בשני הכיוונים אחרי הודעה כזו.",
      sourceName: "Google News — bonds",
      sourceUrl: "https://example.com/story",
    });
    expect(text).toContain(`🎯 על מה זה משפיע: ${toHashtags(FALLBACK_AFFECTS.stocks ?? []).join(" ")}`);
    expect(text).toContain('— <a href="https://example.com/story">Google News</a>');
    expect(text).not.toContain("מילון:");
    expect(text).not.toContain("מקור:");
    const affectsAt = text.indexOf("🎯 על מה זה משפיע:");
    expect(affectsAt).toBeGreaterThan(text.indexOf("מה זה אומר לשוק:"));
    expect(text.indexOf("Google News")).toBeLessThan(text.indexOf("מה זה אומר לשוק:"));
  });

  it("uses a custom category and refuses a non-http source link", () => {
    const text = formatTelegramMessage({
      category: { id: "private-credit", emoji: "🏦", labelHe: "אשראי פרטי", labelEn: "Private credit" },
      headline: "קרנות אשראי פרטי גייסו פחות כסף",
      summary: "הגיוס ברבעון ירד. מנהלי הקרנות דיברו על לווים זהירים יותר.",
      marketMeaning: "גיוס חלש יותר יכול לייקר אשראי לחברות בינוניות.",
      affects: ["yields", "credit"],
      sourceName: "Example & Co",
      sourceUrl: "javascript:alert(1)",
      disclaimer: "",
    });
    expect(text.startsWith("🏦 אשראי פרטי · קרנות אשראי פרטי גייסו פחות כסף")).toBe(true);
    expect(text).toContain(`🎯 על מה זה משפיע: ${toHashtags(GENERIC_AFFECTS).join(" ")}`);
    expect(text).toContain("— Example &amp; Co");
    expect(text).not.toContain("<a ");
    expect(text).not.toContain("javascript:");
    expect(text).not.toContain(DEFAULT_DISCLAIMER);
  });

  it("uses the category fallback when cleanup collapses the tags below three", () => {
    const text = formatTelegramMessage({
      category: stocks,
      headline: "כותרת בעברית פשוטה לדוגמה",
      summary: "משפט ראשון. משפט שני על השוק.",
      marketMeaning: "השוק יכול לזוז בשני הכיוונים אחרי הודעה כזו.",
      affects: ["מניות", "מניות!", "מניות."],
      sourceName: "CNBC",
      sourceUrl: "https://example.com/story",
    });
    expect(text).toContain(`🎯 על מה זה משפיע: ${toHashtags(FALLBACK_AFFECTS.stocks ?? []).join(" ")}`);
  });

  it("escapes HTML in the story text", () => {
    const text = formatTelegramMessage({
      category: stocks,
      headline: "רווח <תחזית>",
      summary: "הרווח עלה ב-5% & יותר.",
      marketMeaning: "השוק הגיב.",
      affects: ["מניות", "אג״ח", "דולר"],
      sourceName: "CNBC",
      sourceUrl: "https://example.com/a?b=1&c=2",
      disclaimer: "למידע בלבד.",
    });
    expect(text).toContain("רווח &lt;תחזית&gt;");
    expect(text).toContain("הרווח עלה ב-5% &amp; יותר.");
    expect(text).toContain('href="https://example.com/a?b=1&amp;c=2"');
  });

  it("keeps a very long message inside Telegram's limit", () => {
    const text = formatTelegramMessage({
      category: stocks,
      headline: "כותרת",
      summary: "משפט. ".repeat(800),
      marketMeaning: "השוק זז. ".repeat(200),
      sourceName: "CNBC",
      sourceUrl: "https://example.com/long",
      disclaimer: DEFAULT_DISCLAIMER,
    });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('<a href="https://example.com/long">CNBC</a>');
    expect(text).toContain(DEFAULT_DISCLAIMER);
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
      expect(sample.text).toContain("🎯 על מה זה משפיע:");
      expect(sample.text).not.toContain("מילון:");
      expect(sample.text).not.toContain("מקור:");
      const marketAt = sample.text.indexOf("מה זה אומר לשוק:");
      const affectsAt = sample.text.indexOf("🎯 על מה זה משפיע:");
      expect(affectsAt).toBeGreaterThan(marketAt);
      expect(sample.text.indexOf("<a href=")).toBeLessThan(marketAt);
      const affectsLine = sample.text.slice(affectsAt, sample.text.indexOf("\n", affectsAt));
      const tags = affectsLine.replace(/^🎯 על מה זה משפיע:\s*/, "").split(" ");
      expect(tags.length).toBeGreaterThanOrEqual(3);
      expect(tags.length).toBeLessThanOrEqual(6);
      for (const tag of tags) {
        expect(tag.startsWith("#")).toBe(true);
        expect(isPrimarilyHebrew(tag.slice(1).replaceAll("_", " "), { minHebrew: 2, minRatio: 0.5 })).toBe(true);
      }
      expect(sample.text).toContain(DEFAULT_DISCLAIMER);
      const [headline = "", , summary = "", , market = ""] = sample.text.split("\n");
      expect(isPrimarilyHebrew(headline.replace(/^.*·\s*/, ""))).toBe(true);
      const summaryText = summary.replace(/\s—\s<a href="[^"]+">[^<]*<\/a>$/, "");
      expect(isPrimarilyHebrew(summaryText)).toBe(true);
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

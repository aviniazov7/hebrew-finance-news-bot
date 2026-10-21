import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_FEEDS } from "../src/catalog.ts";
import { DEFAULT_DISCLAIMER, parseConfig, parseDryRun, parseThreshold } from "../src/config.ts";

describe("config", () => {
  it("defaults dry run to true and the importance threshold to 4", () => {
    expect(parseDryRun(undefined)).toBe(true);
    expect(parseDryRun("")).toBe(true);
    expect(parseDryRun("false")).toBe(false);
    expect(parseDryRun("OFF")).toBe(false);
    expect(parseThreshold(undefined)).toBe(4);
    expect(parseThreshold("5")).toBe(5);
    expect(parseThreshold("9")).toBe(4);
    const config = parseConfig({});
    expect(config.dryRun).toBe(true);
    expect(config.importanceThreshold).toBe(4);
    expect(config.disclaimer).toBe(DEFAULT_DISCLAIMER);
    expect(config.geminiModel).toBe("gemini-3.8-flash");
    expect(config.geminiFallbackModel).toBe("gemini-3.5-flash-lite");
    expect(config.feeds).toHaveLength(DEFAULT_FEEDS.length);
    expect(config.categories).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it("appends extra feeds and lets an extra category override the emoji", () => {
    const config = parseConfig({
      EXTRA_FEEDS: JSON.stringify([
        {
          name: "Private credit",
          url: "https://example.com/private-credit.xml",
          category: "private-credit",
        },
      ]),
      EXTRA_CATEGORIES: JSON.stringify([
        { id: "private-credit", emoji: "🏦", labelHe: "אשראי פרטי", labelEn: "Private credit" },
        { id: "stocks", emoji: "📗", labelHe: "מניות", labelEn: "Stocks" },
      ]),
    });
    expect(config.feeds.some((feed) => feed.category === "private-credit")).toBe(true);
    expect(config.feeds).toHaveLength(DEFAULT_FEEDS.length + 1);
    expect(config.categories.find((category) => category.id === "stocks")?.emoji).toBe("📗");
    expect(config.categories.find((category) => category.id === "private-credit")?.labelHe).toBe("אשראי פרטי");
  });

  it("keeps the defaults when the JSON override is invalid", () => {
    const config = parseConfig({ FEEDS: "{", CATEGORIES: "nope" });
    expect(config.feeds).toHaveLength(DEFAULT_FEEDS.length);
    expect(config.categories).toHaveLength(DEFAULT_CATEGORIES.length);
  });
});

import { describe, expect, it } from "vitest";
import { FALLBACK_AFFECTS } from "../src/affects.ts";
import { DEFAULT_CATEGORIES, DEFAULT_FEEDS } from "../src/catalog.ts";
import { isPrimarilyHebrew } from "../src/hebrew.ts";

describe("default catalog", () => {
  it("gives every category at least one feed", () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(DEFAULT_FEEDS.some((feed) => feed.category === category.id)).toBe(true);
    }
  });

  it("keeps crypto as a minority of the sources", () => {
    const crypto = DEFAULT_FEEDS.filter((feed) => feed.category === "crypto");
    expect(crypto.map((feed) => feed.name).sort()).toEqual(["CoinDesk", "Cointelegraph"]);
    expect(crypto.length / DEFAULT_FEEDS.length).toBeLessThan(0.2);
  });

  it("points every feed at a known https source and fetches policy wires every run", () => {
    const ids = new Set(DEFAULT_CATEGORIES.map((category) => category.id));
    const urls = DEFAULT_FEEDS.map((feed) => feed.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const feed of DEFAULT_FEEDS) {
      expect(feed.url.startsWith("https://")).toBe(true);
      expect(ids.has(feed.category)).toBe(true);
    }
    const priority = new Set(DEFAULT_FEEDS.filter((feed) => feed.priority).map((feed) => feed.name));
    expect(priority.has("Federal Reserve")).toBe(true);
    expect(priority.has("SEC")).toBe(true);
    expect(priority.has("Globes — capital markets")).toBe(true);
    expect(priority.has("Google News — CPI and jobs")).toBe(true);
    expect(priority.has("ECB")).toBe(true);
  });

  it("has a Hebrew fallback affects list for every category", () => {
    for (const category of DEFAULT_CATEGORIES) {
      const affects = FALLBACK_AFFECTS[category.id];
      expect(affects).toBeTruthy();
      expect(affects!.length).toBeGreaterThanOrEqual(3);
      expect(affects!.length).toBeLessThanOrEqual(6);
      for (const phrase of affects!) {
        expect(isPrimarilyHebrew(phrase, { minHebrew: 2, minRatio: 0.5 })).toBe(true);
      }
    }
    expect(FALLBACK_AFFECTS["central-banks"]).toEqual([
      "משכנתאות",
      "הלוואות",
      "ריבית על פיקדונות",
      "מניות צמיחה וטק",
      "שער הדולר-שקל",
      "קריפטו",
    ]);
  });
});

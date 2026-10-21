import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_FEEDS } from "../src/catalog.ts";
import { IMPORTANCE_RUBRIC, pickFeedsForRun, resolvePostedCategory, selectForScoring } from "../src/scoring.ts";
import type { FeedSource, NewsItem } from "../src/types.ts";

function item(id: string, category: string, publishedAt: number): NewsItem {
  return {
    id,
    source: category,
    category,
    title: id,
    link: `https://example.com/${id}`,
    summary: id,
    publishedAt,
  };
}

describe("balanced scoring", () => {
  it("states that crypto is not automatically more important", () => {
    expect(IMPORTANCE_RUBRIC).toContain("not automatically more important");
    expect(IMPORTANCE_RUBRIC).toContain("central-bank");
    expect(IMPORTANCE_RUBRIC).toContain("shekel");
    expect(IMPORTANCE_RUBRIC).toContain("earnings");
  });

  it("does not let a crypto backlog crowd out other categories", () => {
    const now = 1_000;
    const items = [
      ...Array.from({ length: 10 }, (_, index) => item(`crypto-${index}`, "crypto", now - index)),
      item("fed", "central-banks", now - 50),
      item("bonds", "bonds", now - 40),
    ];
    const selected = selectForScoring(items, { limit: 5, perCategory: 2 });
    const counts = selected.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.category] = (acc[entry.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(selected).toHaveLength(4);
    expect(counts.crypto).toBe(2);
    expect(counts["central-banks"]).toBeGreaterThan(0);
    expect(counts.bonds).toBeGreaterThan(0);
  });

  it("uses the full limit when only one category has news", () => {
    const items = Array.from({ length: 8 }, (_, index) => item(`only-${index}`, "crypto", 100 - index));
    expect(selectForScoring(items, { limit: 5, perCategory: 2 })).toHaveLength(5);
  });

  it("keeps priority feeds on every run and rotates the rest", () => {
    const feeds: FeedSource[] = [
      { name: "P", url: "https://example.com/p", category: "markets", priority: true },
      { name: "A", url: "https://example.com/a", category: "stocks" },
      { name: "B", url: "https://example.com/b", category: "bonds" },
      { name: "C", url: "https://example.com/c", category: "macro" },
    ];
    expect(pickFeedsForRun(feeds, 0, 3).map((feed) => feed.name)).toEqual(["P", "A", "B"]);
    expect(pickFeedsForRun(feeds, 5 * 60 * 1000, 3).map((feed) => feed.name)).toEqual(["P", "C", "A"]);
    expect(pickFeedsForRun(feeds, 0, 0).map((feed) => feed.name)).toEqual(["P", "A", "B", "C"]);
    expect(pickFeedsForRun(feeds, 0, 1).map((feed) => feed.name)).toEqual(["P"]);
  });

  it("does not retag a Fed story as crypto unless the text is about crypto", () => {
    const fed = resolvePostedCategory("crypto", "central-banks", "Federal Reserve cut rates", DEFAULT_CATEGORIES);
    expect(fed.id).toBe("central-banks");
    const bitcoin = resolvePostedCategory(
      "crypto",
      "stocks",
      "The company added bitcoin to its treasury",
      DEFAULT_CATEGORIES,
    );
    expect(bitcoin.id).toBe("crypto");
    const housing = resolvePostedCategory("housing", "stocks", "Home sales slowed", DEFAULT_CATEGORIES);
    expect(housing.id).toBe("housing");
    const unknown = resolvePostedCategory("not-a-topic", "bonds", "Yields rose", DEFAULT_CATEGORIES);
    expect(unknown.id).toBe("bonds");
  });

  it("uses the default catalog categories", () => {
    expect(DEFAULT_FEEDS.length).toBeGreaterThan(0);
    expect(DEFAULT_CATEGORIES.some((category) => category.id === "forex")).toBe(true);
  });
});

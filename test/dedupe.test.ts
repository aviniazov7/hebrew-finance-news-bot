import { describe, expect, it } from "vitest";
import {
  DRY_RUN_SEEN_KEY,
  hasSeen,
  hasSeenItem,
  LIVE_SEEN_KEY,
  type SeenMap,
  loadSeen,
  normalizeStoryUrl,
  normalizeTitle,
  parseSeen,
  pendingMarker,
  pruneSeen,
  remember,
  saveSeen,
  seenStorageKey,
  storyTitleKey,
  storyUrlKey,
} from "../src/dedupe.ts";
import { MemoryKv } from "./memory-kv.ts";

describe("dedupe", () => {
  it("treats malformed payloads as an empty set", () => {
    expect(parseSeen(null)).toEqual({});
    expect(parseSeen("not-json")).toEqual({});
    expect(parseSeen("[]")).toEqual({});
    expect(parseSeen('{"ok":"nope","good":10}')).toEqual({ good: 10 });
  });

  it("forgets ids after the ttl and caps the map", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const hour = 60 * 60 * 1000;
    const map = { fresh: now - hour, stale: now - 10 * hour, future: now + hour };
    expect(hasSeen(map, "fresh", now, 3 * hour)).toBe(true);
    expect(hasSeen(map, "stale", now, 3 * hour)).toBe(false);
    expect(hasSeen(map, "missing", now, 3 * hour)).toBe(false);
    const pruned = pruneSeen(map, now, 3 * hour, 1);
    expect(pruned.changed).toBe(true);
    expect(pruned.map).toEqual({ fresh: now - hour });
  });

  it("round-trips one KV write and keeps dry-run state separate", () => {
    expect(seenStorageKey(true)).toBe(DRY_RUN_SEEN_KEY);
    expect(seenStorageKey(false)).toBe(LIVE_SEEN_KEY);
  });

  it("loads and saves a seen map with a single put", async () => {
    const kv = new MemoryKv();
    const now = 1_700_000_000_000;
    const map = parseSeen(null);
    remember(map, "CNBC:1", now);
    await saveSeen(kv, LIVE_SEEN_KEY, map);
    expect(kv.writes).toBe(1);
    const loaded = await loadSeen(kv, LIVE_SEEN_KEY);
    expect(hasSeen(loaded, "CNBC:1", now + 1000, 60_000)).toBe(true);
    expect(await loadSeen(kv, DRY_RUN_SEEN_KEY)).toEqual({});
  });

  it("treats tracking params and publisher suffixes as the same story", () => {
    const publisher = "https://www.cnbc.com/2026/10/22/oil.html?utm_source=rss&utm_medium=feed&id=9#story";
    const tracked = "https://CNBC.com/2026/10/22/oil.html?fbclid=abc&id=9&utm_campaign=gn";
    expect(normalizeStoryUrl(publisher)).toBe(normalizeStoryUrl(tracked));
    expect(normalizeStoryUrl(publisher)).toBe("https://cnbc.com/2026/10/22/oil.html?id=9");
    expect(storyUrlKey(publisher)).toBe(storyUrlKey(tracked));
    expect(normalizeStoryUrl("https://news.google.com/rss/articles/CBMi")).not.toBe(normalizeStoryUrl(publisher));
    expect(normalizeStoryUrl("not a url")).toBeNull();

    const headline = "Brent crude jumps after the supply report";
    expect(normalizeTitle(`  ${headline.toUpperCase()} - Reuters  `)).toBe(normalizeTitle(headline));
    expect(normalizeTitle(`${headline} | Google News`)).toBe(normalizeTitle(headline));
    expect(storyTitleKey(`${headline} - CNBC`)).toBe(storyTitleKey(headline));
    expect(storyTitleKey("Fed holds rates")).not.toBe(storyTitleKey(headline));
    expect(normalizeTitle("בנק ישראל השאיר את הריבית - גלובס")).toBe("בנק ישראל השאיר את הריבית");

    const now = 1_700_000_000_000;
    const map: SeenMap = {};
    remember(map, storyTitleKey(headline) ?? "", now);
    expect(
      hasSeenItem(
        map,
        { id: "Google News:other", link: "https://news.google.com/rss/articles/CBMi", title: `${headline} - Reuters` },
        now,
        60_000,
      ),
    ).toBe(true);
    expect(hasSeenItem(map, { id: "CNBC:1", link: publisher, title: "Different oil headline today" }, now, 60_000)).toBe(
      false,
    );
    remember(map, pendingMarker("CNBC:1"), now);
    expect(hasSeenItem(map, { id: "CNBC:1", link: "https://example.com/other", title: "Other" }, now, 60_000)).toBe(true);
  });
});

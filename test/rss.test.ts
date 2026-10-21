import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/rss.ts";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Finance</title>
    <item>
      <title>AT&amp;T and the Fed</title>
      <link>https://example.com/stories/1</link>
      <guid isPermaLink="false">story-1</guid>
      <pubDate>Wed, 21 Oct 2026 15:30:50 GMT</pubDate>
      <description><![CDATA[<p>Wall Street watched <b>hedge funds</b> add leverage.</p>]]></description>
    </item>
    <item>
      <title>Second story</title>
      <link>https://example.com/stories/2</link>
      <guid>story-2</guid>
      <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
      <description>Short</description>
      <content:encoded><![CDATA[<p>A longer body about bond yields and the Treasury market today.</p>]]></content:encoded>
    </item>
    <item>
      <title>Bad link</title>
      <link>javascript:alert(1)</link>
      <guid>bad</guid>
      <description>This item must be dropped.</description>
    </item>
    <item>
      <title></title>
      <link>https://example.com/stories/empty</link>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Fed</title>
  <entry>
    <title>Federal Reserve issues FOMC statement</title>
    <link rel="alternate" href="https://example.com/fed"/>
    <id>urn:fed:20261021</id>
    <updated>2026-10-21T18:00:00Z</updated>
    <summary>The committee lowered the target range for the federal funds rate.</summary>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS items, CDATA, entities, and dates", () => {
    const items = parseFeed(RSS, { source: "CNBC", category: "stocks", limit: 10 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "CNBC:story-1",
      source: "CNBC",
      category: "stocks",
      title: "AT&T and the Fed",
      link: "https://example.com/stories/1",
    });
    expect(items[0]?.summary).toBe("Wall Street watched hedge funds add leverage.");
    expect(items[0]?.publishedAt).toBe(Date.parse("Wed, 21 Oct 2026 15:30:50 GMT"));
  });

  it("uses content:encoded when the description is short", () => {
    const items = parseFeed(RSS, { source: "CNBC", category: "stocks", limit: 10 });
    expect(items[1]?.summary).toContain("bond yields");
    expect(items[1]?.summary).not.toContain("<p>");
  });

  it("drops items without an http link or title and honors the limit", () => {
    const limited = parseFeed(RSS, { source: "CNBC", category: "stocks", limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.id).toBe("CNBC:story-1");
    const all = parseFeed(RSS, { source: "CNBC", category: "stocks", limit: 10 });
    expect(all.some((item) => item.link.startsWith("javascript:"))).toBe(false);
  });

  it("parses Atom entries and a leading BOM", () => {
    const items = parseFeed(`\uFEFF${ATOM}`, { source: "Federal Reserve", category: "central-banks", limit: 5 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "Federal Reserve:urn:fed:20261021",
      link: "https://example.com/fed",
      category: "central-banks",
      publishedAt: Date.parse("2026-10-21T18:00:00Z"),
    });
  });

  it("keeps Hebrew titles and returns nothing for an empty feed", () => {
    const hebrew = `<rss><channel><item><title>בנק ישראל השאיר את הריבית</title><link>https://example.com/boi</link><guid>boi</guid></item></channel></rss>`;
    const items = parseFeed(hebrew, { source: "Globes", category: "israel", limit: 4 });
    expect(items[0]?.title).toBe("בנק ישראל השאיר את הריבית");
    expect(parseFeed("<rss><channel></channel></rss>", { source: "X", category: "markets", limit: 4 })).toEqual([]);
  });
});

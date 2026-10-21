import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import type { AnalyzeResult } from "../src/gemini.ts";
import { runPipeline } from "../src/pipeline.ts";
import type { NewsItem } from "../src/types.ts";
import { MemoryKv } from "./memory-kv.ts";

const NOW = Date.parse("2026-10-21T16:00:00Z");

function rss(items: Array<{ title: string; id: string; when: string }>): string {
  const body = items
    .map(
      (item) => `<item>
        <title>${item.title}</title>
        <link>https://example.com/${item.id}</link>
        <guid>${item.id}</guid>
        <pubDate>${item.when}</pubDate>
        <description>Enough detail about markets, rates, and prices for a summary of this story.</description>
      </item>`,
    )
    .join("");
  return `<rss version="2.0"><channel>${body}</channel></rss>`;
}

function hebrew(title: string): AnalyzeResult {
  return {
    ok: true,
    analysis: {
      importance: title.includes("minor") ? 2 : 5,
      category: "",
      headline: "כותרת בעברית על אירוע בשוק",
      summary: "זה סיכום קצר בעברית. יש כאן עוד משפט עם העובדה המרכזית. אין כאן מספר שהומצא.",
      marketMeaning: "האירוע יכול להזיז את השוק הרלוונטי בטווח הקצר.",
      affects: [],
      glossary: [
        { term: "CPI", hebrew: "מדד המחירים לצרכן", explanation: "מדד שמראה בכמה התייקרו הקניות של משק בית." },
      ],
    },
  };
}

describe("runPipeline", () => {
  it("scores a balanced slice, logs instead of posting, and does not repeat seen items", async () => {
    const kv = new MemoryKv();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("crypto")) {
        return new Response(
          rss([{ title: "Bitcoin one", id: "c1", when: "Wed, 21 Oct 2026 15:00:00 GMT" }]),
        );
      }
      if (url.includes("macro")) {
        return new Response(rss([{ title: "CPI print", id: "m1", when: "Wed, 21 Oct 2026 15:30:00 GMT" }]));
      }
      return new Response(rss([{ title: "Old", id: "old", when: "Wed, 01 Jan 2020 00:00:00 GMT" }]), { status: 200 });
    };

    const config = parseConfig({
      FEEDS: JSON.stringify([
        { name: "Crypto wire", url: "https://example.com/crypto.xml", category: "crypto" },
        { name: "Macro wire", url: "https://example.com/macro.xml", category: "macro" },
        { name: "Stale wire", url: "https://example.com/old.xml", category: "stocks" },
      ]),
      MAX_ITEMS_PER_RUN: "2",
      MAX_PER_CATEGORY: "1",
      MAX_AGE_HOURS: "18",
      FEEDS_PER_RUN: "0",
      DRY_RUN: "true",
      GEMINI_API_KEY: "test-key",
    });

    const analyze = async (args: { item: NewsItem }): Promise<AnalyzeResult> => {
      calls.push(args.item.category);
      return hebrew(args.item.title);
    };

    const first = await runPipeline({ config, kv, fetchImpl, now: () => NOW, analyze });
    expect(first.dryRun).toBe(2);
    expect(first.posted).toBe(0);
    expect(calls.sort()).toEqual(["crypto", "macro"]);
    expect(kv.writes).toBe(1);

    const second = await runPipeline({ config, kv, fetchImpl, now: () => NOW, analyze });
    expect(second.dryRun).toBe(0);
    expect(second.itemsSelected).toBe(0);
    expect(calls).toHaveLength(2);
    expect(kv.writes).toBe(1);
  });

  it("posts only items at or above the threshold", async () => {
    const kv = new MemoryKv();
    const telegram: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        telegram.push(typeof init?.body === "string" ? init.body : "");
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(
        rss([
          { title: "major event", id: "major", when: "Wed, 21 Oct 2026 15:00:00 GMT" },
          { title: "minor color", id: "minor", when: "Wed, 21 Oct 2026 14:00:00 GMT" },
        ]),
      );
    };

    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
      DRY_RUN: "false",
      GEMINI_API_KEY: "test-key",
      TELEGRAM_BOT_TOKEN: "TEST",
      TELEGRAM_CHAT_ID: "101",
      FEEDS_PER_RUN: "0",
      MAX_PER_CATEGORY: "2",
      IMPORTANCE_THRESHOLD: "4",
    });

    const report = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      analyze: async (args) => hebrew(args.item.title),
    });

    expect(report.posted).toBe(1);
    expect(report.belowThreshold).toBe(1);
    expect(report.postedByCategory.stocks).toBe(1);
    const posted = telegram.find((body) => body.includes("מה זה אומר לשוק"));
    expect(posted).toBeTruthy();
    expect(posted).toContain("📈 מניות ·");
    expect(posted).toContain("🎯 על מה זה משפיע: מדדי המניות, מניות שבבים, מניות הבנקים, אג״ח חברות, תיאבון הסיכון");
    expect(posted).toContain("\"chat_id\":\"101\"");
    expect(posted).not.toContain("TEST");
  });

  it("sends to every subscriber and drops a chat that blocked the bot", async () => {
    const kv = new MemoryKv();
    await kv.put(
      "subscribers:v1",
      JSON.stringify({ "111": 1, "222": 1, "333": 1 }),
    );
    kv.writes = 0;
    const chats: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        const body = typeof init?.body === "string" ? init.body : "";
        const chatId = /"chat_id":"(\d+)"/.exec(body)?.[1] ?? "";
        chats.push(chatId);
        if (chatId === "222") {
          return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), {
            status: 403,
          });
        }
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(rss([{ title: "major event", id: "major", when: "Wed, 21 Oct 2026 15:00:00 GMT" }]));
    };

    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
      DRY_RUN: "false",
      GEMINI_API_KEY: "test-key",
      TELEGRAM_BOT_TOKEN: "TEST",
      TELEGRAM_CHAT_ID: "333",
      FEEDS_PER_RUN: "0",
    });

    const report = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      sleep: async () => {},
      analyze: async (args) => hebrew(args.item.title),
    });

    expect(report.posted).toBe(1);
    expect(report.blocked).toBe(1);
    expect(chats).toEqual(["111", "222", "333"]);
    const stored = JSON.parse((await kv.get("subscribers:v1")) ?? "{}") as Record<string, number>;
    expect(Object.keys(stored).sort()).toEqual(["111", "333"]);
  });
});

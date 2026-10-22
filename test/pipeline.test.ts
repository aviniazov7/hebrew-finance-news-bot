import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { DRY_RUN_SEEN_KEY, LIVE_SEEN_KEY, pendingMarker, storyTitleKey, storyUrlKey } from "../src/dedupe.ts";
import type { AnalyzeResult } from "../src/gemini.ts";
import { RUN_ITEM_BUDGET_MS, runPipeline } from "../src/pipeline.ts";
import type { NewsItem } from "../src/types.ts";
import { MemoryKv } from "./memory-kv.ts";

const NOW = Date.parse("2026-10-21T16:00:00Z");

function rss(items: Array<{ title: string; id: string; when: string; link?: string }>): string {
  const body = items
    .map(
      (item) => `<item>
        <title>${item.title}</title>
        <link>${item.link ?? `https://example.com/${item.id}`}</link>
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
    model: "test-model",
    analysis: {
      importance: title.includes("minor") ? 2 : 5,
      category: "",
      headline: "כותרת בעברית על אירוע בשוק",
      summary: "זה סיכום קצר בעברית. יש כאן עוד משפט עם העובדה המרכזית. אין כאן מספר שהומצא.",
      marketMeaning: "האירוע יכול להזיז את השוק הרלוונטי בטווח הקצר.",
      affects: [],
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
    // Pending marker and confirm write for each of the two stories.
    expect(kv.writes).toBe(4);

    const second = await runPipeline({ config, kv, fetchImpl, now: () => NOW, analyze });
    expect(second.dryRun).toBe(0);
    expect(second.itemsSelected).toBe(0);
    expect(calls).toHaveLength(2);
    expect(kv.writes).toBe(4);
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
    expect(posted).toContain(
      "🎯 על מה זה משפיע: #מדדי_המניות #מניות_שבבים #מניות_הבנקים #אג״ח_חברות #תיאבון_הסיכון",
    );
    expect(posted).toContain('parse_mode":"HTML"');
    expect(posted).toContain('<a href=\\"https://example.com/major\\">CNBC</a>');
    expect(posted).toContain('"is_disabled":false');
    expect(posted).not.toContain("מילון");
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

  it("leaves an item unseen when Gemini and Workers AI all fail, so the next run retries it", async () => {
    const kv = new MemoryKv();
    let geminiCalls = 0;
    let aiCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("generativelanguage.googleapis.com")) {
        geminiCalls += 1;
        return new Response("unavailable", { status: 503 });
      }
      return new Response(rss([{ title: "Fed holds", id: "fed-1", when: "Wed, 21 Oct 2026 15:00:00 GMT" }]));
    };
    const ai = {
      run: async () => {
        aiCalls += 1;
        throw new Error("workers ai timeout");
      },
    };
    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "Fed", url: "https://example.com/fed.xml", category: "central-banks" }]),
      DRY_RUN: "true",
      GEMINI_API_KEY: "test-key",
      FEEDS_PER_RUN: "0",
      MAX_AGE_HOURS: "18",
    });

    const first = await runPipeline({ config, kv, fetchImpl, now: () => NOW, ai });
    expect(first.posted).toBe(0);
    expect(first.dryRun).toBe(0);
    expect(first.errors).toBe(1);
    expect(geminiCalls).toBe(2);
    expect(aiCalls).toBe(1);
    expect(await kv.get("seen:dry-run:v1")).toBeNull();

    const second = await runPipeline({ config, kv, fetchImpl, now: () => NOW, ai });
    expect(second.errors).toBe(1);
    expect(geminiCalls).toBe(4);
    expect(aiCalls).toBe(2);
    expect(await kv.get("seen:dry-run:v1")).toBeNull();
  });

  it("does not fetch feeds when the model key or the live bot token is missing", async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return new Response("no");
    };
    const noKey = await runPipeline({
      config: parseConfig({ DRY_RUN: "true", GEMINI_API_KEY: "  ", FEEDS_PER_RUN: "0" }),
      kv: new MemoryKv(),
      fetchImpl,
      now: () => NOW,
    });
    expect(noKey.errors).toBe(1);
    expect(noKey.feedsConsidered).toBe(0);

    const noToken = await runPipeline({
      config: parseConfig({
        DRY_RUN: "false",
        GEMINI_API_KEY: "test-key",
        TELEGRAM_BOT_TOKEN: "",
        FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
        FEEDS_PER_RUN: "0",
      }),
      kv: new MemoryKv(),
      fetchImpl,
      now: () => NOW,
    });
    expect(noToken.errors).toBe(1);
    expect(fetches).toBe(0);
  });

  it("stops the run on a rate limit and leaves the later story unseen", async () => {
    const kv = new MemoryKv();
    const scored: string[] = [];
    const fetchImpl: typeof fetch = async () =>
      new Response(
        rss([
          { title: "later story", id: "later", when: "Wed, 21 Oct 2026 15:30:00 GMT" },
          { title: "earlier story", id: "earlier", when: "Wed, 21 Oct 2026 14:00:00 GMT" },
        ]),
      );
    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
      DRY_RUN: "true",
      GEMINI_API_KEY: "test-key",
      FEEDS_PER_RUN: "0",
      MAX_PER_CATEGORY: "2",
    });
    const report = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      analyze: async (args) => {
        scored.push(args.item.id);
        return { ok: false, remember: false, reason: "rate_limited" };
      },
    });
    expect(report.itemsSelected).toBe(2);
    expect(report.errors).toBe(1);
    expect(scored).toEqual(["CNBC:earlier"]);
    expect(kv.writes).toBe(0);
    expect(await kv.get(DRY_RUN_SEEN_KEY)).toBeNull();
  });

  it("remembers a rejected Hebrew draft so the next cron does not score it again", async () => {
    const kv = new MemoryKv();
    let calls = 0;
    const fetchImpl: typeof fetch = async () =>
      new Response(rss([{ title: "major event", id: "major", when: "Wed, 21 Oct 2026 15:00:00 GMT" }]));
    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
      DRY_RUN: "true",
      GEMINI_API_KEY: "test-key",
      FEEDS_PER_RUN: "0",
    });
    const analyze = async (): Promise<AnalyzeResult> => {
      calls += 1;
      return { ok: false, remember: true, reason: "rejected" };
    };
    const first = await runPipeline({ config, kv, fetchImpl, now: () => NOW, analyze });
    expect(first.rejected).toBe(1);
    expect(first.dryRun).toBe(0);
    const seen = JSON.parse((await kv.get(DRY_RUN_SEEN_KEY)) ?? "{}") as Record<string, number>;
    expect(seen["CNBC:major"]).toBe(NOW);

    const second = await runPipeline({ config, kv, fetchImpl, now: () => NOW, analyze });
    expect(second.itemsSelected).toBe(0);
    expect(second.rejected).toBe(0);
    expect(calls).toBe(1);
  });

  it("binds the default fetch to globalThis", async () => {
    const original = globalThis.fetch;
    let receiver: unknown = "missing";
    globalThis.fetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response("down", { status: 500 }));
    } as typeof fetch;
    try {
      const kv = new MemoryKv();
      const config = parseConfig({
        DRY_RUN: "true",
        GEMINI_API_KEY: "test-key",
        FEEDS_PER_RUN: "1",
        FEEDS: JSON.stringify([{ name: "Fed", url: "https://example.com/fed.xml", category: "central-banks" }]),
      });
      await runPipeline({ config, kv, now: () => NOW, analyze: async () => hebrew("fed") });
    } finally {
      globalThis.fetch = original;
    }
    expect(receiver).toBe(globalThis);
  });

  it("leaves a posted id in KV when the run throws on the next story", async () => {
    const kv = new MemoryKv();
    let phase: "run" | "kill-next" | "done" = "run";
    const put = kv.put.bind(kv);
    kv.put = async (key, value) => {
      if (phase === "kill-next" && key === DRY_RUN_SEEN_KEY) {
        phase = "done";
        throw new Error("worker killed");
      }
      await put(key, value);
      if (key !== DRY_RUN_SEEN_KEY || phase !== "run") return;
      const map = JSON.parse(value) as Record<string, number>;
      if (map["CNBC:first"] !== undefined && map[pendingMarker("CNBC:first")] === undefined) phase = "kill-next";
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(
        rss([
          { title: "second story", id: "second", when: "Wed, 21 Oct 2026 15:30:00 GMT" },
          { title: "first story", id: "first", when: "Wed, 21 Oct 2026 14:00:00 GMT" },
        ]),
      );
    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
      DRY_RUN: "true",
      GEMINI_API_KEY: "test-key",
      FEEDS_PER_RUN: "0",
      MAX_PER_CATEGORY: "2",
    });
    const scored: string[] = [];
    await expect(
      runPipeline({
        config,
        kv,
        fetchImpl,
        now: () => NOW,
        analyze: async (args) => {
          scored.push(args.item.id);
          return hebrew(args.item.title);
        },
      }),
    ).rejects.toThrow("worker killed");
    const seen = JSON.parse((await kv.get(DRY_RUN_SEEN_KEY)) ?? "{}") as Record<string, number>;
    expect(seen["CNBC:first"]).toBe(NOW);
    expect(seen["CNBC:second"]).toBeUndefined();
    expect(seen[pendingMarker("CNBC:first")]).toBeUndefined();

    const retried: string[] = [];
    const second = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      analyze: async (args) => {
        retried.push(args.item.id);
        return hebrew(args.item.title);
      },
    });
    expect(scored).toEqual(["CNBC:first", "CNBC:second"]);
    expect(retried).toEqual(["CNBC:second"]);
    expect(second.dryRun).toBe(1);
  });

  it("keeps a pending marker when the send throws, so the next run does not repost", async () => {
    const kv = new MemoryKv();
    await kv.put("subscribers:v1", JSON.stringify({ "111": 1, "222": 1 }));
    kv.writes = 0;
    const chats: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        const body = typeof init?.body === "string" ? init.body : "";
        chats.push(/"chat_id":"(\d+)"/.exec(body)?.[1] ?? "");
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(rss([{ title: "major event", id: "major", when: "Wed, 21 Oct 2026 15:00:00 GMT" }]));
    };
    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
      DRY_RUN: "false",
      GEMINI_API_KEY: "test-key",
      TELEGRAM_BOT_TOKEN: "TEST",
      TELEGRAM_CHAT_ID: "",
      FEEDS_PER_RUN: "0",
    });
    await expect(
      runPipeline({
        config,
        kv,
        fetchImpl,
        now: () => NOW,
        sleep: async () => {
          throw new Error("killed mid-send");
        },
        analyze: async (args) => hebrew(args.item.title),
      }),
    ).rejects.toThrow("killed mid-send");
    const seen = JSON.parse((await kv.get(LIVE_SEEN_KEY)) ?? "{}") as Record<string, number>;
    expect(seen[pendingMarker("CNBC:major")]).toBe(NOW);
    expect(chats).toEqual(["111"]);

    const second = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      sleep: async () => {},
      analyze: async () => {
        throw new Error("should not score a pending story");
      },
    });
    expect(second.posted).toBe(0);
    expect(second.itemsSelected).toBe(0);
    expect(chats).toEqual(["111"]);
  });

  it("drops the pending marker when Telegram fails, so the next run can retry", async () => {
    const kv = new MemoryKv();
    let telegramCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        telegramCalls += 1;
        if (telegramCalls === 1) return new Response("unavailable", { status: 500 });
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(rss([{ title: "major event", id: "major", when: "Wed, 21 Oct 2026 15:00:00 GMT" }]));
    };
    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
      DRY_RUN: "false",
      GEMINI_API_KEY: "test-key",
      TELEGRAM_BOT_TOKEN: "TEST",
      TELEGRAM_CHAT_ID: "101",
      FEEDS_PER_RUN: "0",
    });
    const first = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      analyze: async (args) => hebrew(args.item.title),
    });
    expect(first.posted).toBe(0);
    expect(first.errors).toBe(1);
    const seen = JSON.parse((await kv.get(LIVE_SEEN_KEY)) ?? "{}") as Record<string, number>;
    expect(seen["CNBC:major"]).toBeUndefined();
    expect(seen[pendingMarker("CNBC:major")]).toBeUndefined();

    const second = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      analyze: async (args) => hebrew(args.item.title),
    });
    expect(second.posted).toBe(1);
    expect(telegramCalls).toBe(2);
  });

  it("stops before the next story once the run budget is spent and leaves it unseen", async () => {
    const kv = new MemoryKv();
    let elapsed = 0;
    const scored: string[] = [];
    const fetchImpl: typeof fetch = async () =>
      new Response(
        rss([
          { title: "later story", id: "later", when: "Wed, 21 Oct 2026 15:30:00 GMT" },
          { title: "earlier story", id: "earlier", when: "Wed, 21 Oct 2026 14:00:00 GMT" },
        ]),
      );
    const config = parseConfig({
      FEEDS: JSON.stringify([{ name: "CNBC", url: "https://example.com/stocks.xml", category: "stocks" }]),
      DRY_RUN: "true",
      GEMINI_API_KEY: "test-key",
      FEEDS_PER_RUN: "0",
      MAX_PER_CATEGORY: "2",
    });
    const first = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      clock: () => elapsed,
      analyze: async (args) => {
        scored.push(args.item.id);
        elapsed = RUN_ITEM_BUDGET_MS;
        return hebrew(args.item.title);
      },
    });
    expect(first.dryRun).toBe(1);
    expect(first.itemsSelected).toBe(2);
    expect(scored).toEqual(["CNBC:earlier"]);
    const seen = JSON.parse((await kv.get(DRY_RUN_SEEN_KEY)) ?? "{}") as Record<string, number>;
    expect(seen["CNBC:earlier"]).toBe(NOW);
    expect(seen["CNBC:later"]).toBeUndefined();

    elapsed = 0;
    const second = await runPipeline({
      config,
      kv,
      fetchImpl,
      now: () => NOW,
      clock: () => elapsed,
      analyze: async (args) => {
        scored.push(args.item.id);
        return hebrew(args.item.title);
      },
    });
    expect(second.dryRun).toBe(1);
    expect(scored).toEqual(["CNBC:earlier", "CNBC:later"]);
  });

  it("does not post the same story again when the url or the title matches another feed", async () => {
    const kv = new MemoryKv();
    const brent = "Brent crude jumps after the supply report";
    const publisher = "https://www.cnbc.com/2026/10/22/brent.html?utm_source=rss&utm_medium=feed#top";
    const scored: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("cnbc")) {
        return new Response(
          rss([
            {
              title: brent,
              id: "brent",
              link: publisher,
              when: "Wed, 21 Oct 2026 15:00:00 GMT",
            },
          ]),
        );
      }
      if (url.includes("google")) {
        return new Response(
          rss([
            {
              title: `${brent} - Reuters`,
              id: "gn-brent",
              link: "https://news.google.com/rss/articles/CBMiabc",
              when: "Wed, 21 Oct 2026 15:05:00 GMT",
            },
          ]),
        );
      }
      return new Response(
        rss([
          {
            title: "A different oil headline about inventories",
            id: "same-url",
            link: "https://CNBC.com/2026/10/22/brent.html?fbclid=click&utm_campaign=gn",
            when: "Wed, 21 Oct 2026 15:10:00 GMT",
          },
        ]),
      );
    };
    const config = parseConfig({
      FEEDS: JSON.stringify([
        { name: "CNBC", url: "https://example.com/cnbc.xml", category: "stocks" },
        { name: "Google News", url: "https://example.com/google.xml", category: "commodities" },
        { name: "Mirror", url: "https://example.com/mirror.xml", category: "markets" },
      ]),
      DRY_RUN: "true",
      GEMINI_API_KEY: "test-key",
      FEEDS_PER_RUN: "0",
      MAX_ITEMS_PER_RUN: "3",
      MAX_PER_CATEGORY: "2",
    });
    const analyze = async (args: { item: NewsItem }): Promise<AnalyzeResult> => {
      scored.push(args.item.id);
      return hebrew(args.item.title);
    };
    const first = await runPipeline({ config, kv, fetchImpl, now: () => NOW, analyze });
    expect(first.dryRun).toBe(1);
    expect(first.itemsSelected).toBe(1);
    expect(scored).toEqual(["CNBC:brent"]);
    const seen = JSON.parse((await kv.get(DRY_RUN_SEEN_KEY)) ?? "{}") as Record<string, number>;
    expect(seen[storyUrlKey(publisher) ?? ""]).toBe(NOW);
    expect(seen[storyTitleKey(brent) ?? ""]).toBe(NOW);
    expect(seen[storyTitleKey(`${brent} - Reuters`) ?? ""]).toBe(NOW);

    const second = await runPipeline({ config, kv, fetchImpl, now: () => NOW, analyze });
    expect(second.itemsSelected).toBe(0);
    expect(second.dryRun).toBe(0);
    expect(scored).toEqual(["CNBC:brent"]);
  });
});

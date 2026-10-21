import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_FEEDS } from "../src/catalog.ts";
import worker from "../src/index.ts";

const fetches: string[] = [];
const originalFetch = globalThis.fetch;

function testEnv(overrides: Record<string, unknown> = {}): Env {
  const values = new Map<string, string>();
  return {
    DRY_RUN: "true",
    IMPORTANCE_THRESHOLD: "4",
    DISCLAIMER: "למידע בלבד. אין כאן המלצה לפעולה בשוק.",
    GEMINI_MODEL: "gemini-3.8-flash",
    GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite",
    WORKERS_AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    MAX_ITEMS_PER_RUN: "5",
    MAX_PER_CATEGORY: "2",
    MAX_ITEMS_PER_FEED: "4",
    MAX_AGE_HOURS: "18",
    DEDUPE_TTL_HOURS: "72",
    FEEDS_PER_RUN: "0",
    FEEDS: "",
    EXTRA_FEEDS: "",
    CATEGORIES: "",
    EXTRA_CATEGORIES: "",
    TELEGRAM_CHAT_ID: "",
    GEMINI_API_KEY: "",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    NEWS_KV: {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => {
        values.set(key, value);
      },
    },
    AI: { run: async () => ({ response: "" }) },
    ...overrides,
  } as unknown as Env;
}

function controller(): ScheduledController {
  return { cron: "*/5 * * * *", scheduledTime: Date.now(), noRetry: () => {} };
}

beforeEach(() => {
  fetches.length = 0;
  globalThis.fetch = async (input) => {
    fetches.push(String(input));
    return new Response('<rss version="2.0"><channel></channel></rss>');
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("worker entry", () => {
  it("answers /health without calling Gemini, Telegram, or a feed", async () => {
    const env = testEnv();
    const health = await worker.fetch(new Request("https://bot.example/health"), env);
    const root = await worker.fetch(new Request("https://bot.example/"), env);
    const missing = await worker.fetch(new Request("https://bot.example/nope"), env);

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      ok: true,
      service: "hebrew-finance-news-bot",
      dryRun: true,
      importanceThreshold: 4,
      categories: DEFAULT_CATEGORIES.length,
      feeds: DEFAULT_FEEDS.length,
    });
    expect(root.status).toBe(200);
    await expect(root.json()).resolves.toMatchObject({ ok: true, dryRun: true });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not found");
    expect(fetches).toEqual([]);
  });

  it("routes the Telegram webhook through KV and does not run a cron without a Gemini key", async () => {
    const env = testEnv({ TELEGRAM_BOT_TOKEN: "TOKEN" });
    const denied = await worker.fetch(
      new Request("https://bot.example/telegram/webhook", { method: "POST", body: "{}" }),
      env,
    );
    const wrongMethod = await worker.fetch(new Request("https://bot.example/telegram/webhook"), env);
    expect(denied.status).toBe(401);
    expect(wrongMethod.status).toBe(405);

    const started = await worker.fetch(
      new Request("https://bot.example/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "secret" },
        body: JSON.stringify({ update_id: 1, message: { text: "/start", chat: { id: 4242 } } }),
      }),
      env,
    );
    expect(started.status).toBe(200);
    expect(fetches.some((url) => url.includes("api.telegram.org"))).toBe(true);
    expect(await env.NEWS_KV.get("subscribers:v1")).toContain("4242");

    fetches.length = 0;
    await worker.scheduled?.(controller(), env);
    expect(fetches).toEqual([]);
  });

  it("logs and rethrows when the cron cannot read KV", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      errors.push(String(line));
    });
    const env = testEnv({
      GEMINI_API_KEY: "test-key",
      FEEDS: JSON.stringify([{ name: "Fed", url: "https://example.com/fed.xml", category: "central-banks" }]),
      NEWS_KV: {
        get: async () => {
          throw new Error("kv down");
        },
        put: async () => {},
      },
    });

    await expect(worker.scheduled?.(controller(), env)).rejects.toThrow("kv down");
    expect(fetches).toEqual(["https://example.com/fed.xml"]);
    expect(errors.some((line) => line.includes("run_failed") && line.includes("kv down"))).toBe(true);
    spy.mockRestore();
  });
});

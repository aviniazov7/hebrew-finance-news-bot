import { describe, expect, it } from "vitest";
import { ALREADY_STOPPED_TEXT, HELP_TEXT, STOP_TEXT, UNKNOWN_COMMAND_TEXT, WELCOME_TEXT } from "../src/commands.ts";
import { containsInvestmentAdvice, isPrimarilyHebrew } from "../src/hebrew.ts";
import { SUBSCRIBERS_KEY } from "../src/subscribers.ts";
import { handleTelegramWebhook, secretsMatch } from "../src/webhook.ts";
import { MemoryKv } from "./memory-kv.ts";

const SECRET = "webhook-secret";

function update(text: string, chatId = 4242): string {
  return JSON.stringify({ update_id: 1, message: { text, chat: { id: chatId } } });
}

function post(body: string, secret = SECRET): Request {
  return new Request("https://bot.example/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body,
  });
}

describe("telegram webhook", () => {
  it("rejects a missing or wrong secret and accepts the real one", async () => {
    expect(await secretsMatch("nope", SECRET)).toBe(false);
    expect(await secretsMatch("webhook-secret-long", SECRET)).toBe(false);
    expect(await secretsMatch(SECRET, SECRET)).toBe(true);

    const kv = new MemoryKv();
    const missing = await handleTelegramWebhook({
      request: new Request("https://bot.example/telegram/webhook", { method: "POST", body: update("/start") }),
      webhookSecret: SECRET,
      botToken: "TOKEN",
      kv,
    });
    expect(missing.status).toBe(401);
    expect(kv.writes).toBe(0);

    const wrong = await handleTelegramWebhook({
      request: post(update("/start"), "other-secret"),
      webhookSecret: SECRET,
      botToken: "TOKEN",
      kv,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true })),
    });
    expect(wrong.status).toBe(401);
    expect(kv.writes).toBe(0);
  });

  it("subscribes on /start, explains commands on /help, and unsubscribes on /stop", async () => {
    const kv = new MemoryKv();
    const replies: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { text?: string };
      replies.push(body.text ?? "");
      return new Response(JSON.stringify({ ok: true }));
    };
    const base = {
      webhookSecret: SECRET,
      botToken: "TOKEN",
      kv,
      fetchImpl,
      now: () => 1_700_000_000_000,
    };

    const started = await handleTelegramWebhook({ ...base, request: post(update("/start@FinanceBot")) });
    expect(started.status).toBe(200);
    expect(replies[0]).toContain(WELCOME_TEXT);
    expect(replies[0]).toContain("/stop");
    expect(isPrimarilyHebrew(WELCOME_TEXT)).toBe(true);
    expect(containsInvestmentAdvice(WELCOME_TEXT)).toBe(false);
    const stored = JSON.parse((await kv.get(SUBSCRIBERS_KEY)) ?? "{}") as Record<string, number>;
    expect(stored["4242"]).toBe(1_700_000_000_000);
    const writesAfterStart = kv.writes;

    const again = await handleTelegramWebhook({ ...base, request: post(update("/start")) });
    expect(again.status).toBe(200);
    expect(kv.writes).toBe(writesAfterStart);

    const helped = await handleTelegramWebhook({ ...base, request: post(update("/help")) });
    expect(helped.status).toBe(200);
    expect(replies.at(-1)).toContain(HELP_TEXT);
    expect(HELP_TEXT).toContain("/start");
    expect(HELP_TEXT).toContain("/stop");
    expect(HELP_TEXT).toContain("/help");
    expect(kv.writes).toBe(writesAfterStart);

    const stopped = await handleTelegramWebhook({ ...base, request: post(update("/stop")) });
    expect(stopped.status).toBe(200);
    expect(replies.at(-1)).toContain(STOP_TEXT);
    expect(isPrimarilyHebrew(STOP_TEXT)).toBe(true);
    expect(JSON.parse((await kv.get(SUBSCRIBERS_KEY)) ?? "{}")).toEqual({});
  });

  it("replies to an unknown command and to /stop when nobody is subscribed", async () => {
    const kv = new MemoryKv();
    const replies: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { text?: string };
      replies.push(body.text ?? "");
      return new Response(JSON.stringify({ ok: true }));
    };
    const base = { webhookSecret: SECRET, botToken: "TOKEN", kv, fetchImpl };

    const unknown = await handleTelegramWebhook({ ...base, request: post(update("/settings")) });
    expect(unknown.status).toBe(200);
    expect(replies).toEqual([UNKNOWN_COMMAND_TEXT]);
    expect(isPrimarilyHebrew(UNKNOWN_COMMAND_TEXT)).toBe(true);
    expect(kv.writes).toBe(0);

    const stopped = await handleTelegramWebhook({ ...base, request: post(update("/stop")) });
    expect(stopped.status).toBe(200);
    expect(replies[1]).toBe(ALREADY_STOPPED_TEXT);
    expect(isPrimarilyHebrew(ALREADY_STOPPED_TEXT)).toBe(true);
    expect(kv.writes).toBe(0);
    expect(await kv.get(SUBSCRIBERS_KEY)).toBeNull();
  });

  it("ignores ordinary chat text", async () => {
    const kv = new MemoryKv();
    let called = false;
    const response = await handleTelegramWebhook({
      request: post(update("שלום")),
      webhookSecret: SECRET,
      botToken: "TOKEN",
      kv,
      fetchImpl: async () => {
        called = true;
        return new Response(JSON.stringify({ ok: true }));
      },
    });
    expect(response.status).toBe(200);
    expect(called).toBe(false);
    expect(kv.writes).toBe(0);
  });
});

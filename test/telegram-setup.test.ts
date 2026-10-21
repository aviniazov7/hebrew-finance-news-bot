import { describe, expect, it } from "vitest";
import { BOT_COMMANDS } from "../src/commands.ts";
import { registerBot } from "../src/telegram-setup.ts";

describe("telegram setup", () => {
  it("sets the webhook secret and the Hebrew commands", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    await registerBot({
      token: "TOKEN",
      secret: "sek",
      webhookUrl: "https://hebrew-finance-news-bot.example.workers.dev/telegram/webhook",
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ ok: true, result: true }));
      },
    });
    expect(calls[0]?.url).toBe("https://api.telegram.org/botTOKEN/setWebhook");
    expect(calls[0]?.body).toMatchObject({
      url: "https://hebrew-finance-news-bot.example.workers.dev/telegram/webhook",
      secret_token: "sek",
      allowed_updates: ["message"],
    });
    expect(calls[1]?.url).toBe("https://api.telegram.org/botTOKEN/setMyCommands");
    expect(calls[1]?.body).toEqual({ commands: BOT_COMMANDS });
    for (const command of BOT_COMMANDS) {
      expect(command.description).toMatch(/[\u0590-\u05FF]/);
    }
  });

  it("refuses a webhook URL that is not the worker route", async () => {
    await expect(registerBot({ token: "TOKEN", secret: "sek", webhookUrl: "http://example.com/telegram/webhook" })).rejects.toThrow(
      /https/,
    );
  });
});
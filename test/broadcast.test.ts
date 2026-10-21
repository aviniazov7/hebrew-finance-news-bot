import { describe, expect, it } from "vitest";
import { BROADCAST_GAP_MS, broadcastMessage } from "../src/telegram.ts";

describe("broadcast", () => {
  it("paces sends and removes only chats that return 403", async () => {
    const gaps: number[] = [];
    const chats: string[] = [];
    const result = await broadcastMessage({
      text: "שלום שוק",
      dryRun: false,
      token: "TOKEN",
      recipients: ["1", "2", "3"],
      gapMs: BROADCAST_GAP_MS,
      sleep: async (ms) => {
        gaps.push(ms);
      },
      fetchImpl: async (_input, init) => {
        const body = typeof init?.body === "string" ? init.body : "";
        const chatId = /"chat_id":"(\d+)"/.exec(body)?.[1] ?? "";
        chats.push(chatId);
        if (chatId === "2") {
          return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden" }), { status: 403 });
        }
        return new Response(JSON.stringify({ ok: true }));
      },
    });
    expect(gaps).toEqual([BROADCAST_GAP_MS, BROADCAST_GAP_MS]);
    expect(chats).toEqual(["1", "2", "3"]);
    expect(result.sent).toBe(2);
    expect(result.blocked).toEqual(["2"]);
    expect(result.status).toBe("posted");
    expect(JSON.stringify(result)).not.toContain("TOKEN");
  });

  it("logs one dry run and does not call Telegram", async () => {
    let called = false;
    const result = await broadcastMessage({
      text: "טיוטה",
      dryRun: true,
      token: "",
      recipients: ["1", "2"],
      fetchImpl: async () => {
        called = true;
        return new Response("no");
      },
    });
    expect(called).toBe(false);
    expect(result.status).toBe("dry_run");
    expect(result.sent).toBe(0);
  });
});

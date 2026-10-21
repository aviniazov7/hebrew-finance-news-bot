import { HELP_TEXT, parseCommand, STOP_TEXT, UNKNOWN_COMMAND_TEXT, WELCOME_TEXT, ALREADY_STOPPED_TEXT } from "./commands.ts";
import type { KvStore } from "./dedupe.ts";
import { logError, logInfo } from "./log.ts";
import {
  loadSubscribers,
  normalizeChatId,
  saveSubscribers,
  subscribeChat,
  unsubscribeChat,
} from "./subscribers.ts";
import { sendTelegramText } from "./telegram.ts";

const MAX_UPDATE_CHARS = 64_000;
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(providedHash, expectedHash);
  }
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export async function handleTelegramWebhook(args: {
  request: Request;
  webhookSecret: string;
  botToken: string;
  kv: KvStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<Response> {
  if (args.request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const provided = args.request.headers.get(SECRET_HEADER) ?? "";
  if (!args.webhookSecret || !(await secretsMatch(provided, args.webhookSecret))) {
    logError({ message: "webhook_unauthorized" });
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: string;
  try {
    raw = await args.request.text();
  } catch (error) {
    logError({ message: "webhook_body_failed", error: error instanceof Error ? error.message : String(error) });
    return new Response("Bad request", { status: 400 });
  }
  if (raw.length > MAX_UPDATE_CHARS) {
    return new Response("Payload too large", { status: 413 });
  }

  const update = parseUpdate(raw);
  if (!update) {
    logInfo({ message: "webhook_ignored" });
    return new Response("ok");
  }

  const now = (args.now ?? Date.now)();
  const subscribers = await loadSubscribers(args.kv);
  let changed = false;
  let reply = HELP_TEXT;
  if (update.command === "start") {
    changed = subscribeChat(subscribers, update.chatId, now);
    reply = WELCOME_TEXT;
  } else if (update.command === "stop") {
    changed = unsubscribeChat(subscribers, update.chatId);
    reply = changed ? STOP_TEXT : ALREADY_STOPPED_TEXT;
  } else if (update.command === "unknown") {
    reply = UNKNOWN_COMMAND_TEXT;
  }

  if (changed) {
    await saveSubscribers(args.kv, subscribers);
  }
  logInfo({ message: "webhook_command", command: update.command, chatId: update.chatId, changed });

  if (args.botToken) {
    const sent = await sendTelegramText({
      token: args.botToken,
      chatId: update.chatId,
      text: reply,
      fetchImpl: args.fetchImpl,
      preview: false,
    });
    if (!sent.ok) {
      logError({ message: "webhook_reply_failed", chatId: update.chatId, detail: sent.detail });
    }
  } else {
    logError({ message: "webhook_missing_bot_token", chatId: update.chatId });
  }
  return new Response("ok");
}

function parseUpdate(raw: string): { chatId: string; command: "start" | "stop" | "help" | "unknown" } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const message = (value as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const chat = (message as { chat?: { id?: unknown } }).chat;
  const chatId = normalizeChatId(chat?.id);
  if (!chatId) return null;
  const text = (message as { text?: unknown }).text;
  const command = parseCommand(typeof text === "string" ? text : undefined);
  if (!command) return null;
  return { chatId, command };
}

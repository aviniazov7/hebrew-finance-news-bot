import type { KvStore } from "./dedupe.ts";

/** One key for the whole subscriber set, so a cron is one read and at most one write. */
export const SUBSCRIBERS_KEY = "subscribers:v1";

export type SubscriberMap = Record<string, number>;

export function parseSubscribers(raw: string | null): SubscriberMap {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: SubscriberMap = {};
    for (const [key, ts] of Object.entries(value)) {
      const id = normalizeChatId(key);
      if (!id || typeof ts !== "number" || !Number.isFinite(ts)) continue;
      out[id] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

export function normalizeChatId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?\d{1,20}$/.test(value.trim())) return value.trim();
  return null;
}

/** Numeric chat ids, and an optional @username or -100… admin chat. */
export function isDeliverableChat(value: string): boolean {
  const trimmed = value.trim();
  if (normalizeChatId(trimmed)) return true;
  return /^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(trimmed);
}

export function subscribeChat(map: SubscriberMap, chatId: string, now: number): boolean {
  if (map[chatId] !== undefined) return false;
  map[chatId] = now;
  return true;
}

export function unsubscribeChat(map: SubscriberMap, chatId: string): boolean {
  if (map[chatId] === undefined) return false;
  delete map[chatId];
  return true;
}

export function broadcastTargets(subscribers: SubscriberMap, adminChatId: string): string[] {
  const targets = Object.keys(subscribers);
  const admin = adminChatId.trim();
  if (admin && isDeliverableChat(admin) && !targets.includes(admin)) targets.push(admin);
  return targets;
}

export async function loadSubscribers(kv: KvStore): Promise<SubscriberMap> {
  return parseSubscribers(await kv.get(SUBSCRIBERS_KEY));
}

export async function saveSubscribers(kv: KvStore, map: SubscriberMap): Promise<void> {
  await kv.put(SUBSCRIBERS_KEY, JSON.stringify(map));
}

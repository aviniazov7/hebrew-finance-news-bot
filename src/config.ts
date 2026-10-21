import { DEFAULT_CATEGORIES, DEFAULT_FEEDS } from "./catalog.ts";
import { DEFAULT_WORKERS_AI_MODEL } from "./workers-ai.ts";
import { logError } from "./log.ts";
import { safeHttpUrl } from "./text.ts";
import type { Category, FeedSource } from "./types.ts";

export const DEFAULT_DISCLAIMER = "למידע בלבד. אין כאן המלצה לפעולה בשוק.";
export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ConfigInput {
  DRY_RUN?: string;
  IMPORTANCE_THRESHOLD?: string;
  DISCLAIMER?: string;
  GEMINI_MODEL?: string;
  GEMINI_FALLBACK_MODEL?: string;
  WORKERS_AI_MODEL?: string;
  MAX_ITEMS_PER_RUN?: string;
  MAX_PER_CATEGORY?: string;
  MAX_ITEMS_PER_FEED?: string;
  MAX_AGE_HOURS?: string;
  DEDUPE_TTL_HOURS?: string;
  FEEDS_PER_RUN?: string;
  FEEDS?: string;
  EXTRA_FEEDS?: string;
  CATEGORIES?: string;
  EXTRA_CATEGORIES?: string;
  GEMINI_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  /** Optional extra chat, such as the operator's private chat. Empty skips it. */
  TELEGRAM_CHAT_ID?: string;
}

export interface AppConfig {
  dryRun: boolean;
  importanceThreshold: number;
  disclaimer: string;
  geminiModel: string;
  geminiFallbackModel: string;
  workersAiModel: string;
  maxItemsPerRun: number;
  maxPerCategory: number;
  maxItemsPerFeed: number;
  maxAgeHours: number;
  dedupeTtlHours: number;
  feedsPerRun: number;
  feeds: FeedSource[];
  categories: Category[];
  geminiApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
}

export function parseDryRun(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return true;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

export function parseThreshold(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 4;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) return 4;
  return parsed;
}

export function parseConfig(input: ConfigInput): AppConfig {
  const categories = resolveCategories(input.CATEGORIES, input.EXTRA_CATEGORIES);
  return {
    dryRun: parseDryRun(input.DRY_RUN),
    importanceThreshold: parseThreshold(input.IMPORTANCE_THRESHOLD),
    disclaimer: input.DISCLAIMER === undefined ? DEFAULT_DISCLAIMER : input.DISCLAIMER.trim(),
    geminiModel: input.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    geminiFallbackModel: input.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL,
    workersAiModel: input.WORKERS_AI_MODEL?.trim() || DEFAULT_WORKERS_AI_MODEL,
    maxItemsPerRun: parseBoundedInt(input.MAX_ITEMS_PER_RUN, 5, 1, 8),
    maxPerCategory: parseBoundedInt(input.MAX_PER_CATEGORY, 2, 1, 5),
    maxItemsPerFeed: parseBoundedInt(input.MAX_ITEMS_PER_FEED, 4, 1, 10),
    maxAgeHours: parseBoundedInt(input.MAX_AGE_HOURS, 18, 1, 72),
    dedupeTtlHours: parseBoundedInt(input.DEDUPE_TTL_HOURS, 72, 1, 24 * 14),
    feedsPerRun: parseBoundedInt(input.FEEDS_PER_RUN, 12, 0, 30),
    feeds: resolveFeeds(input.FEEDS, input.EXTRA_FEEDS),
    categories,
    geminiApiKey: input.GEMINI_API_KEY?.trim() ?? "",
    telegramBotToken: input.TELEGRAM_BOT_TOKEN?.trim() ?? "",
    telegramChatId: input.TELEGRAM_CHAT_ID?.trim() ?? "",
  };
}

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function resolveCategories(raw: string | undefined, extraRaw: string | undefined): Category[] {
  const base = raw && raw.trim() ? parseCategoryJson(raw, "invalid_categories") ?? DEFAULT_CATEGORIES : DEFAULT_CATEGORIES;
  const extra = extraRaw && extraRaw.trim() ? parseCategoryJson(extraRaw, "invalid_extra_categories") ?? [] : [];
  const merged = new Map(base.map((category) => [category.id, category]));
  for (const category of extra) merged.set(category.id, category);
  return merged.size > 0 ? [...merged.values()] : DEFAULT_CATEGORIES;
}

function resolveFeeds(raw: string | undefined, extraRaw: string | undefined): FeedSource[] {
  const base = raw && raw.trim() ? parseFeedJson(raw, "invalid_feeds") ?? DEFAULT_FEEDS : DEFAULT_FEEDS;
  const extra = extraRaw && extraRaw.trim() ? parseFeedJson(extraRaw, "invalid_extra_feeds") ?? [] : [];
  return dedupeFeeds([...base, ...extra]);
}

function parseCategoryJson(raw: string, errorCode: string): Category[] | null {
  const parsed = parseJsonArray(raw, errorCode);
  if (!parsed) return null;
  const categories = parsed.flatMap((entry) => {
    const category = parseCategory(entry);
    return category ? [category] : [];
  });
  return categories.length > 0 ? categories : null;
}

function parseFeedJson(raw: string, errorCode: string): FeedSource[] | null {
  const parsed = parseJsonArray(raw, errorCode);
  if (!parsed) return null;
  const feeds = parsed.flatMap((entry) => {
    const feed = parseFeed(entry);
    return feed ? [feed] : [];
  });
  return feeds.length > 0 ? feeds : null;
}

function parseJsonArray(raw: string, errorCode: string): unknown[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) {
      logError({ message: errorCode });
      return null;
    }
    return value;
  } catch {
    logError({ message: errorCode });
    return null;
  }
}

function parseCategory(value: unknown): Category | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
  const emoji = typeof value.emoji === "string" ? value.emoji.trim() : "";
  const labelHe = typeof value.labelHe === "string" ? value.labelHe.trim() : "";
  const labelEn = typeof value.labelEn === "string" ? value.labelEn.trim() : "";
  if (!SLUG.test(id) || !emoji || emoji.length > 16 || !labelHe || !labelEn) return null;
  if (labelHe.length > 40 || labelEn.length > 60) return null;
  return { id, emoji, labelHe, labelEn };
}

function parseFeed(value: unknown): FeedSource | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const url = typeof value.url === "string" ? safeHttpUrl(value.url) : null;
  const category = typeof value.category === "string" ? value.category.trim().toLowerCase() : "";
  if (!name || name.length > 80 || !url || !SLUG.test(category)) return null;
  const feed: FeedSource = { name, url, category };
  if (value.priority === true) feed.priority = true;
  return feed;
}

function dedupeFeeds(feeds: FeedSource[]): FeedSource[] {
  const seen = new Set<string>();
  const out: FeedSource[] = [];
  for (const feed of feeds) {
    if (seen.has(feed.url)) continue;
    seen.add(feed.url);
    out.push(feed);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

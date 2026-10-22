export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export const LIVE_SEEN_KEY = "seen:v1";
export const DRY_RUN_SEEN_KEY = "seen:dry-run:v1";

export type SeenMap = Record<string, number>;

export function seenStorageKey(dryRun: boolean): string {
  return dryRun ? DRY_RUN_SEEN_KEY : LIVE_SEEN_KEY;
}

export function parseSeen(raw: string | null): SeenMap {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: SeenMap = {};
    for (const [key, ts] of Object.entries(value)) {
      if (typeof ts === "number" && Number.isFinite(ts)) out[key] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Cap on stored keys. Each story can occupy the id, a pending marker, a
 * normalized URL, and a title hash, so the cap is larger than the old
 * 2,000-id map and still bounds the KV value.
 */
export const SEEN_MAP_CAP = 6000;

export const PENDING_PREFIX = "pending:";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "yclid",
  "twclid",
  "ttclid",
  "gad_source",
  "gad_campaignid",
  "srsltid",
]);

export function pendingMarker(id: string): string {
  return `${PENDING_PREFIX}${id}`;
}

export function pruneSeen(
  map: SeenMap,
  now: number,
  ttlMs: number,
  maxEntries = SEEN_MAP_CAP,
): { map: SeenMap; changed: boolean } {
  const entries = Object.entries(map).filter(([, ts]) => ts <= now && now - ts <= ttlMs);
  entries.sort((a, b) => a[1] - b[1]);
  const capped = entries.length > maxEntries ? entries.slice(entries.length - maxEntries) : entries;
  const next: SeenMap = {};
  for (const [id, ts] of capped) next[id] = ts;
  const before = Object.keys(map);
  let changed = before.length !== Object.keys(next).length;
  if (!changed) {
    for (const key of before) {
      if (map[key] !== next[key]) {
        changed = true;
        break;
      }
    }
  }
  return { map: next, changed };
}

export function hasSeen(map: SeenMap, id: string, now: number, ttlMs: number): boolean {
  const ts = map[id];
  return typeof ts === "number" && ts <= now && now - ts <= ttlMs;
}

export function remember(map: SeenMap, id: string, now: number): void {
  map[id] = now;
}

export async function loadSeen(kv: KvStore, key: string): Promise<SeenMap> {
  return parseSeen(await kv.get(key));
}

export async function saveSeen(kv: KvStore, key: string, map: SeenMap): Promise<void> {
  await kv.put(key, JSON.stringify(map));
}

export interface StoryIdentity {
  id: string;
  link: string;
  title: string;
}

/** Drop fragments and tracking params so the same article URL matches across feeds. */
export function normalizeStoryUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host) url.hostname = host;
  const kept = [...url.searchParams.entries()].filter(([key]) => !isTrackingParam(key));
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function storyUrlKey(link: string): string | null {
  const normalized = normalizeStoryUrl(link);
  if (!normalized) return null;
  return `url:${normalized}`.slice(0, 500);
}

/**
 * Case, punctuation, and a trailing publisher credit (" - Reuters") are
 * ignored so a Google News headline matches the publisher feed.
 */
export function normalizeTitle(title: string): string {
  const cleaned = title
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201f]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const withoutSource = stripPublisherSuffix(cleaned);
  return withoutSource
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function storyTitleKey(title: string): string | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;
  return `title:${fnv1a64(normalized)}`;
}

export function storyFingerprintKeys(item: { link: string; title: string }): string[] {
  const keys: string[] = [];
  const url = storyUrlKey(item.link);
  if (url) keys.push(url);
  const title = storyTitleKey(item.title);
  if (title) keys.push(title);
  return keys;
}

export function hasSeenItem(map: SeenMap, item: StoryIdentity, now: number, ttlMs: number): boolean {
  if (hasSeen(map, item.id, now, ttlMs)) return true;
  if (hasSeen(map, pendingMarker(item.id), now, ttlMs)) return true;
  return storyFingerprintKeys(item).some((key) => hasSeen(map, key, now, ttlMs));
}

function isTrackingParam(key: string): boolean {
  const name = key.toLowerCase();
  return name.startsWith("utm_") || TRACKING_PARAMS.has(name);
}

function stripPublisherSuffix(title: string): string {
  const match = /^(.*?)\s+[-|]\s+([^-|]{1,40})$/.exec(title);
  const headline = match?.[1]?.trim() ?? "";
  const suffix = match?.[2]?.trim() ?? "";
  if (!headline || !suffix || headline.length < 8) return title;
  const words = suffix.split(/\s+/);
  if (words.length === 0 || words.length > 5) return title;
  return headline;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

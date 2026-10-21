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

export function pruneSeen(
  map: SeenMap,
  now: number,
  ttlMs: number,
  maxEntries = 2000,
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

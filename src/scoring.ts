import type { Category, FeedSource, NewsItem } from "./types.ts";

/**
 * Neutral impact rubric. Crypto is judged on the same 1–5 scale as every
 * other market. A loud token headline is not more important than a Fed
 * decision, a CPI print, earnings, or a move in the shekel.
 */
export const IMPORTANCE_RUBRIC = [
  "Score importance from 1 to 5 by the likely near-term effect on broad markets, borrowing costs, or household wealth.",
  "Score the same way for every asset class. A large crypto move is not automatically more important than stocks, bonds, currencies, commodities, earnings, housing, or a central-bank decision.",
  "5 = macro shock: a central-bank decision, a surprise CPI or jobs report, a systemically important bank failure, an oil supply shock, a sudden shekel or dollar jump caused by policy, or a market-wide halt.",
  "4 = likely to move a major market: large-cap earnings surprise, a big merger, an SEC case against a major firm, a tariff that hits trade, a Bank of Israel rate decision, or a top crypto event such as a spot-ETF decision or a major exchange failure.",
  "3 = notable for one sector or one large company, with limited spillover.",
  "2 = single-company color, a routine filing, a small IPO, or an ordinary altcoin price move.",
  "1 = trivia, a listicle, a personality piece, or a price flicker with no new facts.",
  "Do not treat crypto as more important just because the headline is louder.",
].join(" ");

const CRYPTO_TERMS =
  /\b(bitcoin|ethereum|crypto|cryptocurrency|token|blockchain|stablecoin|btc|eth|defi|nft|xrp|solana)\b/i;

export function resolvePostedCategory(
  modelCategory: string | undefined,
  feedCategory: string,
  text: string,
  categories: readonly Category[],
): Category {
  const known = new Set(categories.map((category) => category.id));
  let id = modelCategory?.trim().toLowerCase() ?? "";
  if (!known.has(id)) id = feedCategory;
  if (id === "crypto" && feedCategory !== "crypto" && !CRYPTO_TERMS.test(text)) {
    id = feedCategory;
  }
  if (!known.has(id)) {
    id = known.has("markets") ? "markets" : (categories[0]?.id ?? feedCategory);
  }
  return categories.find((category) => category.id === id) ?? categories[0]!;
}

/**
 * Pick items to score. When more than one category has fresh news, each
 * category is capped so a crypto backlog cannot fill the run. A quiet day
 * with only one category may use the full limit.
 */
export function selectForScoring(
  items: readonly NewsItem[],
  opts: { limit: number; perCategory: number },
): NewsItem[] {
  if (opts.limit <= 0 || items.length === 0) return [];
  const groups = new Map<string, NewsItem[]>();
  for (const item of items) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  }
  const cats = [...groups.keys()].sort(
    (a, b) => (groups.get(b)![0]?.publishedAt ?? 0) - (groups.get(a)![0]?.publishedAt ?? 0),
  );
  const cap = groups.size <= 1 ? opts.limit : Math.max(1, opts.perCategory);
  const picked: NewsItem[] = [];
  const counts = new Map<string, number>();
  let progressed = true;
  while (picked.length < opts.limit && progressed) {
    progressed = false;
    for (const cat of cats) {
      if (picked.length >= opts.limit) break;
      const used = counts.get(cat) ?? 0;
      const list = groups.get(cat) ?? [];
      if (used >= cap || used >= list.length) continue;
      const next = list[used];
      if (!next) continue;
      picked.push(next);
      counts.set(cat, used + 1);
      progressed = true;
    }
  }
  return picked;
}

const ROTATION_MS = 5 * 60 * 1000;

/**
 * Priority feeds (Fed, SEC, CPI/jobs, Israel, other central banks) are fetched
 * every run. The rest rotate so one invocation stays inside the free-plan
 * subrequest budget. If priority feeds alone exceed the cap, they are still
 * all fetched.
 */
export function pickFeedsForRun(
  feeds: readonly FeedSource[],
  nowMs: number,
  perRun: number,
): FeedSource[] {
  if (perRun <= 0 || perRun >= feeds.length) return feeds.slice();
  const priority = feeds.filter((feed) => feed.priority);
  const rotating = feeds.filter((feed) => !feed.priority);
  if (rotating.length === 0) return priority.slice();
  const slots = Math.max(0, perRun - priority.length);
  if (slots === 0) return priority.slice();
  const windowSize = Math.min(slots, rotating.length);
  const slot = Math.floor(nowMs / ROTATION_MS);
  const start = (slot * windowSize) % rotating.length;
  const window: FeedSource[] = [];
  for (let i = 0; i < windowSize; i += 1) {
    const feed = rotating[(start + i) % rotating.length];
    if (feed) window.push(feed);
  }
  return [...priority, ...window];
}

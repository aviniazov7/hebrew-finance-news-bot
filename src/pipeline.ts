import type { AppConfig } from "./config.ts";
import { hasSeen, loadSeen, pruneSeen, remember, saveSeen, seenStorageKey, type KvStore } from "./dedupe.ts";
import { analyzeItem, type AnalyzeResult } from "./gemini.ts";
import { BODY_CHAR_CAP, mapPool, readLimitedText, USER_AGENT } from "./http.ts";
import { logError, logInfo } from "./log.ts";
import { formatTelegramMessage } from "./format.ts";
import { parseFeed } from "./rss.ts";
import { pickFeedsForRun, resolvePostedCategory, selectForScoring } from "./scoring.ts";
import { deliverMessage } from "./telegram.ts";
import type { NewsItem } from "./types.ts";

export interface RunReport {
  feedsConsidered: number;
  feedsFetched: number;
  feedsFailed: number;
  itemsParsed: number;
  itemsSelected: number;
  posted: number;
  dryRun: number;
  belowThreshold: number;
  rejected: number;
  errors: number;
  postedByCategory: Record<string, number>;
}

export async function runPipeline(deps: {
  config: AppConfig;
  kv: KvStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  analyze?: typeof analyzeItem;
}): Promise<RunReport> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? Date.now)();
  const analyze = deps.analyze ?? analyzeItem;
  const report = emptyReport();
  const { config } = deps;

  if (!config.geminiApiKey) {
    logError({ message: "missing_gemini_key" });
    report.errors += 1;
    return report;
  }
  if (!config.dryRun && (!config.telegramBotToken || !config.telegramChannelId)) {
    logError({ message: "telegram_not_configured" });
    report.errors += 1;
    return report;
  }

  const feeds = pickFeedsForRun(config.feeds, now, config.feedsPerRun);
  report.feedsConsidered = feeds.length;
  const fetched = await mapPool(feeds, 4, async (feed) => {
    try {
      const xml = await fetchFeed(feed.url, fetchImpl);
      return { feed, xml, error: null as string | null };
    } catch (error) {
      return { feed, xml: "", error: error instanceof Error ? error.message : String(error) };
    }
  });

  const items: NewsItem[] = [];
  for (const result of fetched) {
    if (result.error) {
      report.feedsFailed += 1;
      logError({ message: "feed_failed", feed: result.feed.name, error: result.error.slice(0, 200) });
      continue;
    }
    report.feedsFetched += 1;
    items.push(
      ...parseFeed(result.xml, {
        source: result.feed.name,
        category: result.feed.category,
        limit: config.maxItemsPerFeed,
      }),
    );
  }
  report.itemsParsed = items.length;

  const ttlMs = config.dedupeTtlHours * 60 * 60 * 1000;
  const maxAgeMs = config.maxAgeHours * 60 * 60 * 1000;
  const storageKey = seenStorageKey(config.dryRun);
  const loaded = await loadSeen(deps.kv, storageKey);
  const pruned = pruneSeen(loaded, now, ttlMs);
  const seen = pruned.map;

  const fresh: NewsItem[] = [];
  const freshIds = new Set<string>();
  for (const item of items) {
    if (freshIds.has(item.id) || hasSeen(seen, item.id, now, ttlMs)) continue;
    if (!isFresh(item, now, maxAgeMs)) continue;
    freshIds.add(item.id);
    fresh.push(item);
  }

  const selected = selectForScoring(fresh, {
    limit: config.maxItemsPerRun,
    perCategory: config.maxPerCategory,
  });
  report.itemsSelected = selected.length;
  const ordered = selected.slice().sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0));
  const toRemember: string[] = [];

  for (const item of ordered) {
    let result: AnalyzeResult;
    try {
      result = await analyze({
        item,
        categories: config.categories,
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
        fallbackModel: config.geminiFallbackModel,
        fetchImpl,
      });
    } catch (error) {
      report.errors += 1;
      logError({
        message: "analyze_failed",
        id: item.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!result.ok) {
      if (result.reason === "rejected") {
        report.rejected += 1;
        toRemember.push(item.id);
        logInfo({ message: "rejected_output", id: item.id, source: item.source });
      } else {
        report.errors += 1;
        logError({ message: "analyze_skipped", id: item.id, reason: result.reason });
        if (result.reason === "auth" || result.reason === "rate_limited") break;
      }
      continue;
    }

    if (result.analysis.importance < config.importanceThreshold) {
      report.belowThreshold += 1;
      toRemember.push(item.id);
      logInfo({
        message: "below_threshold",
        id: item.id,
        importance: result.analysis.importance,
        threshold: config.importanceThreshold,
        category: item.category,
      });
      continue;
    }

    const category = resolvePostedCategory(
      result.analysis.category,
      item.category,
      `${item.title}\n${item.summary}`,
      config.categories,
    );
    const text = formatTelegramMessage({
      category,
      headline: result.analysis.headline,
      summary: result.analysis.summary,
      marketMeaning: result.analysis.marketMeaning,
      glossary: result.analysis.glossary,
      sourceName: item.source,
      sourceUrl: item.link,
      disclaimer: config.disclaimer,
    });
    const delivery = await deliverMessage({
      text,
      dryRun: config.dryRun,
      token: config.telegramBotToken,
      channelId: config.telegramChannelId,
      fetchImpl,
      logContext: { id: item.id, source: item.source, category: category.id, importance: result.analysis.importance },
    });
    if (delivery.status === "failed") {
      report.errors += 1;
      logError({ message: "deliver_failed", id: item.id, detail: delivery.detail });
      continue;
    }
    if (delivery.status === "dry_run") report.dryRun += 1;
    else report.posted += 1;
    report.postedByCategory[category.id] = (report.postedByCategory[category.id] ?? 0) + 1;
    toRemember.push(item.id);
  }

  if (toRemember.length > 0 || pruned.changed) {
    for (const id of toRemember) remember(seen, id, now);
    const finalMap = pruneSeen(seen, now, ttlMs).map;
    await saveSeen(deps.kv, storageKey, finalMap);
  }
  return report;
}

async function fetchFeed(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readLimitedText(response, BODY_CHAR_CAP);
}

function isFresh(item: NewsItem, now: number, maxAgeMs: number): boolean {
  if (item.publishedAt === null) return true;
  if (item.publishedAt > now + 24 * 60 * 60 * 1000) return false;
  return now - item.publishedAt <= maxAgeMs;
}

function emptyReport(): RunReport {
  return {
    feedsConsidered: 0,
    feedsFetched: 0,
    feedsFailed: 0,
    itemsParsed: 0,
    itemsSelected: 0,
    posted: 0,
    dryRun: 0,
    belowThreshold: 0,
    rejected: 0,
    errors: 0,
    postedByCategory: {},
  };
}

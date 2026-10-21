import { fallbackAffects } from "./affects.ts";
import { toHashtags } from "./hashtags.ts";
import { resolveAffects } from "./hebrew.ts";
import type { Category } from "./types.ts";
import { collapseWhitespace, safeHttpUrl } from "./text.ts";

export interface FormatInput {
  category: Category;
  headline: string;
  summary: string;
  marketMeaning: string;
  /** Model phrases. A short or empty list is replaced by the category default. */
  affects?: readonly string[];
  sourceName: string;
  sourceUrl: string;
  disclaimer?: string;
}

const TELEGRAM_LIMIT = 4000;

export function formatTelegramMessage(input: FormatInput): string {
  const headline = collapseWhitespace(input.headline);
  let summary = collapseWhitespace(input.summary);
  let market = collapseWhitespace(input.marketMeaning).replace(/^מה זה אומר לשוק:\s*/, "");
  let affects = hashtagsFor(resolveAffects(input.affects, input.category.id), input.category.id);
  const url = safeHttpUrl(input.sourceUrl);
  const disclaimer = input.disclaimer?.trim() ?? "";
  const credit = sourceCredit(input.sourceName, url);

  const build = (): string => {
    const lines = [
      `${input.category.emoji} ${escapeHtml(input.category.labelHe)} · ${escapeHtml(headline)}`,
      "",
      `${escapeHtml(summary)} ${credit}`,
      "",
      `מה זה אומר לשוק: ${escapeHtml(market)}`,
      "",
      `🎯 על מה זה משפיע: ${affects.join(" ")}`,
    ];
    if (disclaimer) lines.push("", escapeHtml(disclaimer));
    return lines.join("\n");
  };

  let message = build();
  if (message.length <= TELEGRAM_LIMIT) return message;

  summary = trimWithEllipsis(summary, 700);
  message = build();
  if (message.length <= TELEGRAM_LIMIT) return message;

  market = trimWithEllipsis(market, 280);
  message = build();
  if (message.length <= TELEGRAM_LIMIT) return message;

  affects = affects.slice(0, 3);
  message = build();
  if (message.length <= TELEGRAM_LIMIT) return message;
  return `${message.slice(0, TELEGRAM_LIMIT - 1)}…`;
}

/** Publisher label for the short credit. CNBC sections collapse to CNBC. */
export function shortSourceName(name: string): string {
  const collapsed = collapseWhitespace(name);
  const head = collapsed.split(/\s+[—–-]\s+/)[0]?.trim() || collapsed;
  if (/^cnbc\b/i.test(head)) return "CNBC";
  return head;
}

function hashtagsFor(phrases: readonly string[], categoryId: string): string[] {
  const tags = toHashtags(phrases);
  if (tags.length >= 3) return tags;
  const fallback = toHashtags(fallbackAffects(categoryId));
  return fallback.length >= 3 ? fallback : tags;
}

function sourceCredit(name: string, url: string | null): string {
  const label = escapeHtml(shortSourceName(name));
  if (!url) return `— ${label}`;
  return `— <a href="${escapeAttr(url)}">${label}</a>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function trimWithEllipsis(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

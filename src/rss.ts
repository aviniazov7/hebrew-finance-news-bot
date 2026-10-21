import { stripBom, unwrapMarkup, safeHttpUrl } from "./text.ts";
import type { NewsItem } from "./types.ts";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function elementInner(block: string, tagName: string): string | undefined {
  const name = escapeRegExp(tagName);
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, "i").exec(block);
  return match?.[1];
}

function extractLink(block: string): string | null {
  const textLink = safeHttpUrl(unwrapMarkup(elementInner(block, "link")));
  if (textLink) return textLink;

  const tags = block.match(/<link\b[^>]*>/gi) ?? [];
  let fallback: string | null = null;
  for (const tag of tags) {
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(tag);
    const href = hrefMatch?.[1] ?? hrefMatch?.[2];
    if (!href) continue;
    const url = safeHttpUrl(unwrapMarkup(href));
    if (!url) continue;
    const relMatch = /\brel\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(tag);
    const rel = (relMatch?.[1] ?? relMatch?.[2] ?? "alternate").toLowerCase();
    if (rel.split(/\s+/).includes("alternate")) return url;
    fallback ??= url;
  }

  const guid = unwrapMarkup(elementInner(block, "guid") ?? elementInner(block, "id"));
  return fallback ?? safeHttpUrl(guid);
}

function extractDate(block: string): number | null {
  const raw =
    elementInner(block, "pubDate") ??
    elementInner(block, "published") ??
    elementInner(block, "updated") ??
    elementInner(block, "dc:date");
  if (!raw) return null;
  const parsed = Date.parse(unwrapMarkup(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractSummary(block: string): string {
  const parts = ["description", "summary", "content:encoded"]
    .map((tag) => unwrapMarkup(elementInner(block, tag)))
    .filter((part) => part.length > 0);
  const useful = parts.find((part) => part.length >= 40) ?? parts[0] ?? "";
  return useful.slice(0, 2000);
}

function extractBlocks(xml: string, tagName: string): string[] {
  const name = escapeRegExp(tagName);
  const open = new RegExp(`<${name}\\b[^>]*>`, "gi");
  const close = new RegExp(`</${name}\\s*>`, "gi");
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml)) !== null) {
    close.lastIndex = match.index + match[0].length;
    const end = close.exec(xml);
    if (!end) break;
    blocks.push(xml.slice(match.index + match[0].length, end.index));
    open.lastIndex = end.index + end[0].length;
  }
  return blocks;
}

export function parseFeed(
  xml: string,
  opts: { source: string; category: string; limit: number },
): NewsItem[] {
  const document = stripBom(xml).slice(0, 120_000);
  const items = extractBlocks(document, "item");
  const blocks = items.length > 0 ? items : extractBlocks(document, "entry");
  const parsed: NewsItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (parsed.length >= opts.limit) break;
    const title = unwrapMarkup(elementInner(block, "title"));
    const link = extractLink(block);
    if (!title || !link) continue;
    const guid = unwrapMarkup(elementInner(block, "guid") ?? elementInner(block, "id"));
    const id = `${opts.source}:${guid || link}`.slice(0, 300);
    if (seen.has(id)) continue;
    seen.add(id);
    parsed.push({
      id,
      source: opts.source,
      category: opts.category,
      title,
      link,
      summary: extractSummary(block),
      publishedAt: extractDate(block),
    });
  }
  return parsed;
}

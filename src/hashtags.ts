const GERSHAYIM = "\u05F4";

/**
 * Turns one affected-area phrase into a Telegram hashtag.
 * Spaces and dashes become underscores. ASCII quotes become Hebrew gershayim
 * so אג"ח stays one tag. Anything else that would end a hashtag is dropped.
 * Returns null when no Hebrew letter remains.
 */
export function toHashtag(raw: string): string | null {
  const quoted = raw.normalize("NFKC").replace(/["“”„‟«»]/g, GERSHAYIM);
  const underscored = quoted.replace(/[\s\u00A0\u05BE\u2010-\u2015-]+/g, "_");
  const kept = underscored.replace(/[^\u05D0-\u05EA\u05F3\u05F4\d_]/g, "");
  const term = kept.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!/[\u05D0-\u05EA]/.test(term)) return null;
  return `#${term}`;
}

/** Unique hashtags, in order, capped at six. */
export function toHashtags(phrases: readonly string[]): string[] {
  const tags: string[] = [];
  for (const phrase of phrases) {
    const tag = toHashtag(phrase);
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === 6) break;
  }
  return tags;
}

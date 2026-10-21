import type { Category, GlossaryEntry } from "./types.ts";
import { collapseWhitespace, safeHttpUrl } from "./text.ts";

export interface FormatInput {
  category: Category;
  headline: string;
  summary: string;
  marketMeaning: string;
  glossary?: readonly GlossaryEntry[];
  sourceName: string;
  sourceUrl: string;
  disclaimer?: string;
}

const TELEGRAM_LIMIT = 4000;

export function formatTelegramMessage(input: FormatInput): string {
  const headline = collapseWhitespace(input.headline);
  let summary = collapseWhitespace(input.summary);
  let market = collapseWhitespace(input.marketMeaning).replace(/^מה זה אומר לשוק:\s*/, "");
  let glossary = (input.glossary ?? [])
    .map((entry) => ({
      term: collapseWhitespace(entry.term),
      hebrew: collapseWhitespace(entry.hebrew),
      explanation: collapseWhitespace(entry.explanation),
    }))
    .filter((entry) => entry.term && entry.hebrew && entry.explanation)
    .slice(0, 2);
  const url = safeHttpUrl(input.sourceUrl);
  const disclaimer = input.disclaimer?.trim() ?? "";

  const build = (): string => {
    const lines = [
      `${input.category.emoji} ${input.category.labelHe} · ${headline}`,
      "",
      summary,
      "",
      `מה זה אומר לשוק: ${market}`,
    ];
    if (glossary.length > 0) {
      const bits = glossary.map((entry) => `${entry.hebrew} (${entry.term}) — ${entry.explanation}`);
      lines.push("", `מילון: ${bits.join("; ")}`);
    }
    lines.push("", url ? `מקור: ${input.sourceName} — ${url}` : `מקור: ${input.sourceName}`);
    if (disclaimer) lines.push("", disclaimer);
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

  glossary = [];
  message = build();
  if (message.length <= TELEGRAM_LIMIT) return message;
  return `${message.slice(0, TELEGRAM_LIMIT - 1)}…`;
}

function trimWithEllipsis(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

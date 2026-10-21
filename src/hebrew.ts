import { fallbackAffects } from "./affects.ts";
import type { Analysis, GlossaryEntry } from "./types.ts";
import { collapseWhitespace } from "./text.ts";

const HEBREW_CHAR = /[\u0590-\u05FF]/g;
const LATIN_CHAR = /[A-Za-z]/g;

const ADVICE_PATTERNS: readonly RegExp[] = [
  /כדאי\s+לקנות/,
  /כדאי\s+למכור/,
  /כדאי\s+להשקיע/,
  /מומלץ\s+לקנות/,
  /מומלץ\s+למכור/,
  /מומלץ\s+להשקיע/,
  /זמן\s+לקנות/,
  /זמן\s+למכור/,
  /קנו\s+עכשיו/,
  /מכרו\s+עכשיו/,
  /המלצת\s+קנייה/,
  /המלצת\s+מכירה/,
  /\byou should (buy|sell|invest)\b/i,
  /\b(buy|sell) (now|the dip)\b/i,
  /\bstrong buy\b/i,
  /\binvestment advice\b/i,
];

export function isPrimarilyHebrew(
  text: string,
  opts?: { minHebrew?: number; minRatio?: number },
): boolean {
  const minHebrew = opts?.minHebrew ?? 8;
  const minRatio = opts?.minRatio ?? 0.6;
  const hebrew = text.match(HEBREW_CHAR)?.length ?? 0;
  const latin = text.match(LATIN_CHAR)?.length ?? 0;
  if (hebrew < minHebrew) return false;
  if (latin === 0) return true;
  return hebrew / (hebrew + latin) >= minRatio;
}

export function containsInvestmentAdvice(text: string): boolean {
  return ADVICE_PATTERNS.some((pattern) => pattern.test(text));
}

const AFFECTS_LABEL = /^(?:🎯\s*)?על מה זה משפיע:\s*/;

/** Hebrew phrases the model returned. Fewer than three means the caller should use the category fallback. */
export function validAffects(raw: readonly string[] | undefined): string[] {
  const cleaned: string[] = [];
  for (const piece of raw ?? []) {
    for (const part of piece.replace(AFFECTS_LABEL, "").split(/[,،;]/)) {
      const item = cleanAffect(part);
      if (!item || cleaned.includes(item)) continue;
      cleaned.push(item);
      if (cleaned.length === 6) return cleaned;
    }
  }
  return cleaned;
}

/**
 * Three to six concrete Hebrew phrases. A usable model list is kept.
 * Anything shorter is replaced by the category default.
 */
export function resolveAffects(raw: readonly string[] | undefined, categoryId: string): string[] {
  const cleaned = validAffects(raw);
  if (cleaned.length >= 3) return cleaned;
  return fallbackAffects(categoryId);
}

function cleanAffect(value: string): string | null {
  const text = collapseWhitespace(value).replace(/^[-–•]\s*/, "");
  if (text.length < 2 || text.length > 48) return null;
  if (!isPrimarilyHebrew(text, { minHebrew: 2, minRatio: 0.5 })) return null;
  if (containsInvestmentAdvice(text)) return null;
  return text;
}

export function sanitizeAnalysis(analysis: Analysis): Analysis | null {
  const headline = analysis.headline.trim();
  const summary = analysis.summary.trim();
  const marketMeaning = analysis.marketMeaning.trim();
  if (!isPrimarilyHebrew(headline) || !isPrimarilyHebrew(summary) || !isPrimarilyHebrew(marketMeaning)) {
    return null;
  }
  if (containsInvestmentAdvice(`${headline}\n${summary}\n${marketMeaning}`)) return null;
  const glossary = analysis.glossary.filter(keepGlossaryEntry).slice(0, 2);
  return { ...analysis, headline, summary, marketMeaning, affects: validAffects(analysis.affects), glossary };
}

function keepGlossaryEntry(entry: GlossaryEntry): boolean {
  const term = entry.term.trim();
  const hebrew = entry.hebrew.trim();
  const explanation = entry.explanation.trim();
  if (!term || !hebrew || !explanation) return false;
  if (!isPrimarilyHebrew(hebrew, { minHebrew: 2, minRatio: 0.5 })) return false;
  if (!isPrimarilyHebrew(explanation, { minHebrew: 5, minRatio: 0.55 })) return false;
  return !containsInvestmentAdvice(`${hebrew}\n${explanation}`);
}

import { sanitizeAnalysis } from "./hebrew.ts";
import { IMPORTANCE_RUBRIC } from "./scoring.ts";
import type { Analysis, Category, GlossaryEntry, NewsItem } from "./types.ts";

export class GeminiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

export type AnalyzeResult =
  | { ok: true; analysis: Analysis }
  | { ok: false; remember: boolean; reason: "auth" | "rate_limited" | "rejected" | "transport" };

export const HEBREW_RETRY_NOTE =
  "הניסיון הקודם לא היה בעברית תקינה או שכלל ניסוח של המלצה. כתוב מחדש את headline, summary, marketMeaning ו-affects בעברית יומיומית פשוטה, בלי לומר לקורא לקנות, למכור או להשקיע.";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    importance: { type: "integer", description: "Market impact from 1 to 5, using the rubric." },
    category: { type: "string", description: "One allowed category id." },
    headline: { type: "string" },
    summary: { type: "string" },
    marketMeaning: { type: "string" },
    affects: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      description:
        "3 to 6 short Hebrew noun phrases naming concrete things this story can move, such as mortgages, deposit rates, or the dollar-shekel rate.",
      items: { type: "string" },
    },
    glossary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          hebrew: { type: "string" },
          explanation: { type: "string" },
        },
        required: ["term", "hebrew", "explanation"],
      },
    },
  },
  required: ["importance", "category", "headline", "summary", "marketMeaning", "affects", "glossary"],
};

export function buildSystemInstruction(categories: readonly Category[]): string {
  const allowed = categories.map((category) => `${category.id} (${category.labelEn})`).join(", ");
  return [
    "You edit a Telegram channel that explains global finance in simple Hebrew for adults who do not work in finance.",
    "Cover the whole market: crypto, stocks, capital markets, bonds, earnings, central banks, macro data, commodities, currencies, Israel, IPOs, mergers, regulation, housing, trade and geopolitics, big tech, and banks. Do not favor crypto.",
    "The source text may be English or Hebrew. Always write headline, summary, marketMeaning, affects, and glossary explanations in plain everyday Hebrew.",
    "summary is 2 or 3 short sentences. Use only facts present in the source. Do not invent numbers, quotes, or causes.",
    "marketMeaning is one sentence on how stocks, bonds, currencies, commodities, or crypto might react. Describe the mechanism. Do not tell anyone to buy, sell, hold, or invest. Do not say כדאי, מומלץ, קנו, or מכרו.",
    "affects is 3 to 6 short Hebrew noun phrases for concrete things this specific story can move. For an interest-rate decision a good list is: משכנתאות, הלוואות, ריבית על פיקדונות, מניות צמיחה וטק, שער הדולר-שקל, קריפטו. Name things a reader recognizes. Do not write a sentence and do not give advice.",
    "glossary has 0, 1, or 2 terms a non-expert may not know, such as hedge fund, CPI, rate cut, yield, ETF, or tariff. term is the English name. hebrew is the everyday Hebrew name. explanation is one short Hebrew sentence. If the story is already plain, return an empty array.",
    "Prefer the feed category hint unless the story clearly belongs in another allowed category. Do not label a story as crypto unless it is about cryptocurrency.",
    `Allowed categories: ${allowed}.`,
    IMPORTANCE_RUBRIC,
    "Return only JSON that matches the schema. Do not add a disclaimer and do not wrap the JSON in markdown.",
  ].join("\n");
}

export function buildUserPrompt(item: NewsItem, remind: boolean): string {
  const published = item.publishedAt ? new Date(item.publishedAt).toISOString() : "unknown";
  return [
    remind ? HEBREW_RETRY_NOTE : "",
    `Feed category hint: ${item.category}`,
    `Source: ${item.source}`,
    `Published: ${published}`,
    `Title: ${item.title}`,
    `Link: ${item.link}`,
    `Text: ${item.summary.slice(0, 1800)}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function parseAnalysis(text: string): Analysis | null {
  let value: unknown;
  try {
    value = extractJsonObject(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const importance = parseImportance(record.importance);
  if (importance === null) return null;
  if (
    typeof record.headline !== "string" ||
    typeof record.summary !== "string" ||
    typeof record.marketMeaning !== "string"
  ) {
    return null;
  }
  return {
    importance,
    category: typeof record.category === "string" ? record.category.trim().toLowerCase() : "",
    headline: record.headline,
    summary: record.summary,
    marketMeaning: record.marketMeaning,
    affects: asAffects(record.affects),
    glossary: asGlossary(record.glossary),
  };
}

export async function analyzeItem(args: {
  item: NewsItem;
  categories: readonly Category[];
  apiKey: string;
  model: string;
  fallbackModel: string;
  fetchImpl?: typeof fetch;
}): Promise<AnalyzeResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const system = buildSystemInstruction(args.categories);
  const attempts = [
    { model: args.model, remind: false },
    { model: args.model, remind: true },
    { model: args.fallbackModel, remind: true },
  ];
  let sawRejection = false;
  for (const attempt of attempts) {
    try {
      const text = await generateFlexible({
        model: attempt.model,
        apiKey: args.apiKey,
        system,
        user: buildUserPrompt(args.item, attempt.remind),
        fetchImpl,
      });
      const parsed = parseAnalysis(text);
      const clean = parsed ? sanitizeAnalysis(parsed) : null;
      if (!clean) {
        sawRejection = true;
        continue;
      }
      return { ok: true, analysis: clean };
    } catch (error) {
      if (error instanceof GeminiError && (error.status === 401 || error.status === 403)) {
        return { ok: false, remember: false, reason: "auth" };
      }
      if (error instanceof GeminiError && error.status === 429) {
        return { ok: false, remember: false, reason: "rate_limited" };
      }
    }
  }
  return sawRejection
    ? { ok: false, remember: true, reason: "rejected" }
    : { ok: false, remember: false, reason: "transport" };
}

async function generateFlexible(args: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  try {
    return await generate({ ...args, thinking: true });
  } catch (error) {
    if (error instanceof GeminiError && error.status === 400) {
      return await generate({ ...args, thinking: false });
    }
    throw error;
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
}

async function generate(args: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  thinking: boolean;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseJsonSchema: RESPONSE_SCHEMA,
    maxOutputTokens: 2048,
  };
  if (args.thinking) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  const response = await args.fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": args.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: "user", parts: [{ text: args.user }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new GeminiError(`gemini ${response.status}: ${detail}`, response.status);
  }
  const data = (await response.json()) as GeminiResponse;
  const text = extractGeminiText(data);
  if (!text) throw new GeminiError("gemini empty response", 502);
  return text;
}

function extractGeminiText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => part.text && part.thought !== true)
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no json");
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  }
}

function parseImportance(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function asAffects(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asGlossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: GlossaryEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.term !== "string" ||
      typeof record.hebrew !== "string" ||
      typeof record.explanation !== "string"
    ) {
      continue;
    }
    entries.push({ term: record.term, hebrew: record.hebrew, explanation: record.explanation });
  }
  return entries;
}

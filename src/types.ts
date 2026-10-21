export interface Category {
  id: string;
  emoji: string;
  labelHe: string;
  labelEn: string;
}

export interface FeedSource {
  name: string;
  url: string;
  category: string;
  /** Fetched on every cron run. Other feeds rotate so a free-plan invocation stays small. */
  priority?: boolean;
}

export interface NewsItem {
  id: string;
  source: string;
  category: string;
  title: string;
  link: string;
  summary: string;
  publishedAt: number | null;
}

export interface Analysis {
  importance: number;
  category: string;
  headline: string;
  summary: string;
  marketMeaning: string;
  /** Three to six short Hebrew tag terms. Empty when the model omitted a usable list. */
  affects: string[];
}

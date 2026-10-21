import type { Category, FeedSource } from "./types.ts";

/**
 * Default topic list. Override or extend it with the CATEGORIES and
 * EXTRA_CATEGORIES environment variables. The emoji marks the topic, not
 * whether prices rose or fell.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "crypto", emoji: "₿", labelHe: "קריפטו", labelEn: "Crypto" },
  { id: "stocks", emoji: "📈", labelHe: "מניות", labelEn: "Stocks" },
  { id: "markets", emoji: "📰", labelHe: "שוקי הון", labelEn: "Capital markets" },
  { id: "bonds", emoji: "💵", labelHe: "אג״ח", labelEn: "Bonds and yields" },
  { id: "earnings", emoji: "📊", labelHe: "דוחות", labelEn: "Earnings" },
  { id: "central-banks", emoji: "🏦", labelHe: "בנק מרכזי", labelEn: "Central banks" },
  { id: "macro", emoji: "📋", labelHe: "מאקרו", labelEn: "Macro data" },
  { id: "commodities", emoji: "🛢️", labelHe: "סחורות", labelEn: "Commodities" },
  { id: "forex", emoji: "💱", labelHe: "מט״ח", labelEn: "Currencies" },
  { id: "israel", emoji: "🇮🇱", labelHe: "ישראל", labelEn: "Israel" },
  { id: "ipo", emoji: "🔔", labelHe: "הנפקות", labelEn: "IPOs" },
  { id: "ma", emoji: "🤝", labelHe: "מיזוגים", labelEn: "Mergers and acquisitions" },
  { id: "regulation", emoji: "⚖️", labelHe: "רגולציה", labelEn: "Regulation" },
  { id: "housing", emoji: "🏠", labelHe: "נדל״ן", labelEn: "Housing" },
  { id: "geopolitics", emoji: "🌍", labelHe: "סחר ועולם", labelEn: "Geopolitics and trade" },
  { id: "tech", emoji: "🤖", labelHe: "טק ו-AI", labelEn: "Tech and AI" },
  { id: "banks", emoji: "🏛️", labelHe: "בנקים", labelEn: "Banks and fintech" },
];

function googleNews(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

/**
 * Free public feeds checked in October 2026. Official publishers are used
 * where a feed exists. Google News search RSS fills gaps: BLS blocks
 * anonymous clients, and the Bank of Israel does not publish a working RSS.
 * Two crypto feeds share one category so they cannot crowd out the rest.
 */
export const DEFAULT_FEEDS: FeedSource[] = [
  {
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    category: "central-banks",
    priority: true,
  },
  {
    name: "ECB",
    url: "https://www.ecb.europa.eu/rss/press.html",
    category: "central-banks",
    priority: true,
  },
  {
    name: "Bank of England",
    url: "https://www.bankofengland.co.uk/rss/news",
    category: "central-banks",
    priority: true,
  },
  {
    name: "SEC",
    url: "https://www.sec.gov/news/pressreleases.rss",
    category: "regulation",
    priority: true,
  },
  {
    name: "Google News — CPI and jobs",
    url: googleNews(
      '"consumer price index" OR "jobs report" OR "nonfarm payrolls" OR "unemployment rate"',
    ),
    category: "macro",
    priority: true,
  },
  {
    name: "Globes — capital markets",
    url: "https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=585",
    category: "israel",
    priority: true,
  },
  {
    name: "CNBC Finance",
    url: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
    category: "stocks",
  },
  {
    name: "CNBC Earnings",
    url: "https://www.cnbc.com/id/15839135/device/rss/rss.html",
    category: "earnings",
  },
  {
    name: "CNBC Economy",
    url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    category: "macro",
  },
  {
    name: "CNBC Tech",
    url: "https://www.cnbc.com/id/19854910/device/rss/rss.html",
    category: "tech",
  },
  {
    name: "CNBC Energy",
    url: "https://www.cnbc.com/id/19836768/device/rss/rss.html",
    category: "commodities",
  },
  {
    name: "CNBC Real Estate",
    url: "https://www.cnbc.com/id/10000115/device/rss/rss.html",
    category: "housing",
  },
  {
    name: "MarketWatch",
    url: "https://feeds.marketwatch.com/marketwatch/topstories/",
    category: "markets",
  },
  {
    name: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    category: "crypto",
  },
  {
    name: "Cointelegraph",
    url: "https://cointelegraph.com/rss",
    category: "crypto",
  },
  {
    name: "Google News — bonds",
    url: googleNews('"Treasury yield" OR "bond yields" OR "government bond"'),
    category: "bonds",
  },
  {
    name: "Google News — currencies",
    url: googleNews('forex OR "dollar index" OR "EUR/USD" OR shekel OR "US dollar"'),
    category: "forex",
  },
  {
    name: "Google News — commodities",
    url: googleNews('"gold price" OR "silver price" OR "crude oil" OR "natural gas"'),
    category: "commodities",
  },
  {
    name: "Google News — Israel",
    url: googleNews('"Bank of Israel" OR "Tel Aviv Stock" OR TASE OR "Bank Hapoalim" OR Leumi'),
    category: "israel",
  },
  {
    name: "Google News — IPOs",
    url: googleNews('"initial public offering" OR "files for IPO" OR "IPO pricing"'),
    category: "ipo",
  },
  {
    name: "Google News — M&A",
    url: googleNews('"merger agreement" OR "takeover bid" OR "agrees to acquire"'),
    category: "ma",
  },
  {
    name: "Google News — banks and fintech",
    url: googleNews('"bank earnings" OR fintech OR "regional banks" OR "investment banking"'),
    category: "banks",
  },
  {
    name: "Google News — trade and tariffs",
    url: googleNews('tariff OR tariffs OR "trade war" OR sanctions'),
    category: "geopolitics",
  },
];

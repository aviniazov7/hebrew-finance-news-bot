export const USER_AGENT =
  "hebrew-finance-news-bot/0.1 (+https://github.com/aviniazov7/hebrew-finance-news-bot)";

/** Newest RSS entries are at the top. Capping the body keeps free-plan CPU small. */
export const BODY_CHAR_CAP = 40_000;

export async function readLimitedText(response: Response, maxChars: number): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, maxChars);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (out.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.slice(0, maxChars);
}

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(limit, 1), items.length);
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  }
  if (workers === 0) return results;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

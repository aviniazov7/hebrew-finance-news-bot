import { BOT_COMMANDS } from "./commands.ts";

export async function registerBot(args: {
  token: string;
  webhookUrl: string;
  secret: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const webhookUrl = validateWebhookUrl(args.webhookUrl);
  const fetchImpl = args.fetchImpl ?? fetch;
  await telegramPost(fetchImpl, args.token, "setWebhook", {
    url: webhookUrl,
    secret_token: args.secret,
    allowed_updates: ["message"],
  });
  await telegramPost(fetchImpl, args.token, "setMyCommands", {
    commands: BOT_COMMANDS,
  });
}

export function validateWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("WEBHOOK_URL must be an https URL");
  }
  if (url.protocol !== "https:") throw new Error("WEBHOOK_URL must use https");
  if (url.pathname !== "/telegram/webhook") {
    throw new Error("WEBHOOK_URL path must be /telegram/webhook");
  }
  return url.toString();
}

async function telegramPost(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  body: unknown,
): Promise<void> {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const detail = (await response.text()).slice(0, 300);
  if (!response.ok || !/"ok"\s*:\s*true/.test(detail)) {
    throw new Error(`telegram ${method} ${response.status}: ${detail.replaceAll(token, "[redacted]")}`);
  }
}

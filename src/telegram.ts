import { logInfo } from "./log.ts";

/** About 25 messages per second. Telegram's global cap is near 30 per second. */
export const BROADCAST_GAP_MS = 40;

export type SendResult =
  | { ok: true }
  | { ok: false; blocked: boolean; status: number; detail: string };

export type BroadcastResult = {
  status: "dry_run" | "posted" | "failed";
  sent: number;
  blocked: string[];
  retryable: boolean;
  detail: string;
};

export async function sendTelegramText(args: {
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  preview?: boolean;
  /** News uses HTML so the source name can be a link. Command replies stay plain text. */
  parseMode?: "HTML";
}): Promise<SendResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${args.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: args.chatId,
        text: args.text,
        ...(args.parseMode ? { parse_mode: args.parseMode } : {}),
        link_preview_options: { is_disabled: args.preview === false },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, blocked: false, status: 0, detail: redact(message, args.token) };
  }
  if (response.ok) return { ok: true };
  const detail = redact((await response.text()).slice(0, 500), args.token);
  const blocked = response.status === 403 || errorCode(detail) === 403;
  return { ok: false, blocked, status: response.status, detail: `telegram ${response.status}: ${detail}`.slice(0, 300) };
}

export async function broadcastMessage(args: {
  text: string;
  dryRun: boolean;
  token: string;
  recipients: readonly string[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  gapMs?: number;
  logContext?: Record<string, unknown>;
}): Promise<BroadcastResult> {
  if (args.dryRun) {
    logInfo({
      message: "dry_run_post",
      ...args.logContext,
      recipientCount: args.recipients.length,
      text: args.text,
    });
    return { status: "dry_run", sent: 0, blocked: [], retryable: false, detail: "" };
  }

  const sleep = args.sleep ?? defaultSleep;
  const gapMs = args.gapMs ?? BROADCAST_GAP_MS;
  const blocked: string[] = [];
  let sent = 0;
  for (let i = 0; i < args.recipients.length; i++) {
    const chatId = args.recipients[i] ?? "";
    if (i > 0 && gapMs > 0) await sleep(gapMs);
    const result = await sendTelegramText({
      token: args.token,
      chatId,
      text: args.text,
      fetchImpl: args.fetchImpl,
      parseMode: "HTML",
    });
    if (result.ok) {
      sent += 1;
      continue;
    }
    if (result.blocked) {
      blocked.push(chatId);
      logInfo({ message: "subscriber_blocked", ...args.logContext, chatId });
      continue;
    }
    logInfo({ message: "deliver_failed", ...args.logContext, chatId, detail: result.detail });
    return { status: "failed", sent, blocked, retryable: true, detail: result.detail };
  }
  logInfo({ message: "posted", ...args.logContext, sent, blocked: blocked.length });
  return { status: "posted", sent, blocked, retryable: false, detail: "" };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(detail: string): number | null {
  try {
    const parsed = JSON.parse(detail) as { error_code?: unknown };
    return typeof parsed.error_code === "number" ? parsed.error_code : null;
  } catch {
    const match = /"error_code"\s*:\s*(\d+)/.exec(detail);
    return match ? Number(match[1]) : null;
  }
}

function redact(detail: string, token: string): string {
  return token ? detail.replaceAll(token, "[redacted]") : detail;
}

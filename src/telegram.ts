import { logInfo } from "./log.ts";

export type DeliveryResult =
  | { status: "dry_run" }
  | { status: "posted" }
  | { status: "failed"; retryable: boolean; detail: string };

export async function deliverMessage(args: {
  text: string;
  dryRun: boolean;
  token: string;
  channelId: string;
  fetchImpl?: typeof fetch;
  logContext?: Record<string, unknown>;
}): Promise<DeliveryResult> {
  if (args.dryRun) {
    logInfo({ message: "dry_run_post", ...args.logContext, text: args.text });
    return { status: "dry_run" };
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://api.telegram.org/bot${args.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: args.channelId,
      text: args.text,
      link_preview_options: { is_disabled: false },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    return {
      status: "failed",
      retryable: true,
      detail: `telegram ${response.status}: ${detail}`,
    };
  }
  logInfo({ message: "posted", ...args.logContext });
  return { status: "posted" };
}

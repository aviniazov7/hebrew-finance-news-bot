import { registerBot } from "../src/telegram-setup.ts";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
const webhookUrl = process.env.WEBHOOK_URL?.trim() ?? "";

if (!token || !secret || !webhookUrl) {
  console.error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and WEBHOOK_URL.");
  process.exit(1);
}

try {
  await registerBot({ token, secret, webhookUrl });
  console.log("Webhook and Hebrew bot commands are set.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

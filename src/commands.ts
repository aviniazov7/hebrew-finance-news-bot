export const BOT_COMMANDS = [
  { command: "start", description: "הרשמה לעדכוני חדשות פיננסיות" },
  { command: "stop", description: "ביטול ההרשמה לעדכונים" },
  { command: "help", description: "הסבר קצר על הפקודות" },
] as const;

export type BotCommand = (typeof BOT_COMMANDS)[number]["command"];

export const WELCOME_TEXT = [
  "שלום, נרשמת לעדכונים.",
  "",
  "אני שולח חדשות פיננסיות חשובות מכל העולם, בעברית פשוטה: כותרת, סיכום קצר, מה זה אומר לשוק, ועל מה זה משפיע. בלי המלצה לקנות או למכור.",
  "",
  "כדי להפסיק, שלחו /stop.",
].join("\n");

export const STOP_TEXT = "ההרשמה בוטלה. לא אשלח עוד עדכונים לצ'אט הזה. אפשר לחזור עם /start.";

export const ALREADY_STOPPED_TEXT = "אין הרשמה פעילה לצ'אט הזה. שלחו /start כדי לקבל עדכונים.";

export const HELP_TEXT = [
  "/start — הרשמה לעדכוני חדשות פיננסיות בעברית פשוטה.",
  "/stop — ביטול ההרשמה. אחרי זה לא נשלחים עוד עדכונים.",
  "/help — ההסבר הזה.",
].join("\n");

export const UNKNOWN_COMMAND_TEXT = "לא זיהיתי את הפקודה. /help מציג את הפקודות.";

export function parseCommand(text: string | undefined): BotCommand | "unknown" | null {
  if (!text) return null;
  const match = /^\/([A-Za-z0-9_]+)(?:@[\w_]+)?(?:\s|$)/.exec(text.trim());
  if (!match) return null;
  const name = match[1]?.toLowerCase();
  if (name === "start" || name === "stop" || name === "help") return name;
  return "unknown";
}

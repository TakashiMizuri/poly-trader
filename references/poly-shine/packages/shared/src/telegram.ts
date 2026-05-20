export type TelegramSeverity = "info" | "warning" | "critical";

export function formatTelegramMessage(opts: {
  title: string;
  body: string;
  severity: TelegramSeverity;
}): string {
  const prefix =
    opts.severity === "critical"
      ? "🚨 CRITICAL"
      : opts.severity === "warning"
        ? "⚠️ WARNING"
        : "ℹ️ INFO";
  return `${prefix}: ${opts.title}\n\n${opts.body}`;
}

export async function sendTelegramMessage(opts: {
  botToken: string;
  chatId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.telegram.org/bot${opts.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: opts.chatId,
      text: opts.text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    return { ok: false, error: errText };
  }
  return { ok: true };
}

export function parseTelegramAdminChatIds(): string[] {
  const raw = process.env.TELEGRAM_ADMIN_CHAT_IDS ?? process.env.TELEGRAM_CHAT_ID ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function notifyAdmins(opts: {
  title: string;
  body: string;
  severity: TelegramSeverity;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const text = formatTelegramMessage(opts);
  for (const chatId of parseTelegramAdminChatIds()) {
    const res = await sendTelegramMessage({ botToken: token, chatId, text });
    if (!res.ok) {
      console.error("Telegram send failed", chatId, res.error);
    }
  }
}

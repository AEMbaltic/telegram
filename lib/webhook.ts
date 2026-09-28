import { record, storageConfigured, type ChatMessage } from "./chat";
import { defaultChatId, telegram } from "./telegram";

type Update = {
  message?: {
    message_id: number;
    date: number;
    chat: { id: number };
    from?: { first_name?: string };
    text?: string;
    caption?: string;
  };
};

/**
 * Point Telegram at /api/bot on the production domain, unless it already is.
 *
 * Runs on cold start (instrumentation.ts), so a deploy is all it takes and a
 * rotated MCP_SECRET re-registers itself. Refuses without a Blob store: the
 * webhook turns off getUpdates, and get_telegram_replies would have nothing to
 * read.
 */
export async function ensureWebhook() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const secret = process.env.MCP_SECRET;
  if (!host || !secret || !process.env.TELEGRAM_BOT_TOKEN) {
    console.warn("Telegram webhook not registered: needs VERCEL_PROJECT_PRODUCTION_URL, MCP_SECRET and TELEGRAM_BOT_TOKEN.");
    return;
  }
  if (!storageConfigured()) {
    console.warn("Telegram webhook not registered: connect a private Blob store to the project first.");
    return;
  }

  const url = `https://${host}/api/bot/${secret}`;
  const info = (await telegram("getWebhookInfo", {})) as {
    url?: string;
    last_error_date?: number;
    last_error_message?: string;
  };
  if (info.url === url) {
    if (info.last_error_message) {
      const when = new Date((info.last_error_date ?? 0) * 1000).toISOString();
      console.warn(`Telegram webhook last failed at ${when}: ${info.last_error_message}`);
    }
    return;
  }

  // While no webhook is set, getUpdates still holds the last day of messages. Keep
  // them, so get_telegram_replies does not come back empty after the switch.
  if (!info.url) {
    const chatId = defaultChatId();
    const updates = (await telegram("getUpdates", { limit: 100 })) as Update[];
    const carried: ChatMessage[] = updates
      .map((u) => u.message)
      .filter((m): m is NonNullable<typeof m> => !!m && String(m.chat.id) === chatId)
      .filter((m) => !!(m.text ?? m.caption))
      .map((m) => ({
        id: m.message_id,
        date: m.date,
        from: "aksels",
        name: m.from?.first_name,
        text: (m.text ?? m.caption)!,
      }));
    if (carried.length) await record(carried);
  }

  await telegram("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    // One delivery at a time keeps messages in order.
    max_connections: 1,
    // Those are already carried over above; redelivering them would start Roberts
    // on old messages.
    drop_pending_updates: true,
  });
  console.log(`Telegram webhook registered at https://${host}/api/bot/<MCP_SECRET>`);
}

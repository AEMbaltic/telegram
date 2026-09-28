import { after } from "next/server";
import { record, sessionWaiting, type ChatMessage } from "../../../../lib/chat";
import { fireFailureText, fireRoberts, fireText } from "../../../../lib/roberts";
import { defaultChatId, secretMatches, telegram } from "../../../../lib/telegram";

// POST /api/bot/<MCP_SECRET> — Telegram's webhook, registered by instrumentation.ts.
//
// Every message from Aksels is saved for get_telegram_replies. Then either a
// session is already listening (it read replies in the last ten minutes), and
// saving is all there is to do, or nobody is, and this starts Roberts with the
// message and the ten before it.

export const maxDuration = 60;

type TelegramUpdate = {
  message?: {
    message_id: number;
    date: number;
    chat: { id: number };
    from?: { first_name?: string };
    text?: string;
    caption?: string;
    reply_to_message?: { text?: string; caption?: string };
  };
};

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (!secretMatches(secret)) return new Response("Not found", { status: 404 });
  // Telegram echoes the secret_token set with the webhook, so the URL alone is not
  // enough to post into this.
  if (req.headers.get("x-telegram-bot-api-secret-token") !== process.env.MCP_SECRET) {
    return new Response("Not found", { status: 404 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return Response.json({ ok: true, skipped: "unparseable body" });
  }

  // Anything else gets a 200 too, or Telegram keeps redelivering it.
  const message = update.message;
  if (!message) return Response.json({ ok: true, skipped: "not a message" });
  const chatId = message.chat.id;
  // A bot is reachable by anyone who knows its username; only Aksels gets through.
  if (String(chatId) !== defaultChatId()) return Response.json({ ok: true, skipped: "other chat" });

  const text = (message.text ?? message.caption)?.trim();
  if (!text) {
    after(() =>
      telegram("sendMessage", { chat_id: chatId, text: "Roberts only reads text. Please type it." }).catch(
        (err) => console.error("Could not answer a non-text message:", err),
      ),
    );
    return Response.json({ ok: true, skipped: "no text" });
  }

  const entry: ChatMessage = {
    id: message.message_id,
    date: message.date,
    from: "aksels",
    name: message.from?.first_name,
    text,
    replyTo: message.reply_to_message?.text ?? message.reply_to_message?.caption,
  };

  let history: ChatMessage[] = [entry];
  let waiting = false;
  try {
    const saved = await record([entry]);
    if (!saved.added.length) return Response.json({ ok: true, skipped: "already handled" });
    history = saved.messages;
    waiting = await sessionWaiting();
  } catch (err) {
    // Starting Roberts without the history beats dropping the message.
    console.error("Chat storage failed, handing the message to Roberts without it:", err);
  }

  if (waiting) return Response.json({ ok: true, handled: "saved for the waiting session" });

  // Telegram waits on this response before sending the next update, so the slow
  // part runs after it.
  after(async () => {
    const ack = telegram("sendMessage", { chat_id: chatId, text: "Roberts is on it." }).catch((err) =>
      console.error("Could not send the acknowledgement:", err),
    );
    try {
      await fireRoberts(fireText(entry, history));
    } catch (err) {
      console.error("Firing Roberts failed:", err);
      await ack;
      await telegram("sendMessage", { chat_id: chatId, text: fireFailureText(err) }).catch((e) =>
        console.error("Could not report the failure:", e),
      );
    }
    await ack;
  });
  return Response.json({ ok: true, handled: "firing Roberts" });
}

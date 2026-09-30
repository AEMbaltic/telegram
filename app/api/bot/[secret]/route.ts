import { after } from "next/server";
import { record, sessionWaiting, type ChatMessage } from "../../../../lib/chat";
import { fireFailureText, fireRoberts, fireText } from "../../../../lib/roberts";
import { defaultChatId, secretMatches, telegram } from "../../../../lib/telegram";
import { tooLong, transcribe, type Recording } from "../../../../lib/voice";

// POST /api/bot/<MCP_SECRET> — Telegram's webhook, registered by instrumentation.ts.
//
// Every message from Aksels is saved for get_telegram_replies, voice notes as
// their transcript. Then either a session is already listening (it read replies
// in the last ten minutes), and saving is all there is to do, or nobody is, and
// this starts Roberts with the message and the ten before it.

// Room for a download, a 20 s transcription and a 25 s fire in one request.
export const maxDuration = 90;

type Message = {
  message_id: number;
  date: number;
  chat: { id: number };
  from?: { first_name?: string };
  text?: string;
  caption?: string;
  voice?: Recording;
  audio?: Recording;
  video_note?: Recording;
  reply_to_message?: { text?: string; caption?: string };
};

type TelegramUpdate = { message?: Message };

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

  // Voice notes, audio files and round videos are transcribed and then handled
  // exactly like typed text.
  const recording = message.voice ?? message.audio ?? message.video_note;
  if (recording) {
    const kind = message.voice ? "voice" : message.audio ? "audio" : "video_note";
    if (tooLong(recording)) {
      after(() => reply(chatId, "Too long - max 10 min."));
      return Response.json({ ok: true, skipped: "recording too long" });
    }
    // Transcribing takes seconds, and Telegram holds the next update until this
    // responds, so all of it runs after the response.
    after(async () => {
      let transcript: string;
      try {
        transcript = await transcribe(recording, kind);
      } catch (err) {
        // The message names the step and HTTP status; it never holds the key or audio.
        console.error("Voice transcription failed:", err instanceof Error ? err.message : String(err));
        await reply(chatId, "Could not understand the voice note - please try again or type it.");
        return;
      }
      await reply(chatId, `Heard: "${transcript.slice(0, 4000)}"`);
      const entry = toEntry(message, `(voice) ${transcript}`);
      const { outcome, history } = await save(entry);
      if (outcome === "fire") await handOff(chatId, entry, history);
    });
    return Response.json({ ok: true, handled: "transcribing" });
  }

  const text = (message.text ?? message.caption)?.trim();
  if (!text) {
    after(() => reply(chatId, "Roberts only reads text and voice notes. Please type it."));
    return Response.json({ ok: true, skipped: "no text" });
  }

  const entry = toEntry(message, text);
  const { outcome, history } = await save(entry);
  if (outcome === "duplicate") return Response.json({ ok: true, skipped: "already handled" });
  if (outcome === "waiting") return Response.json({ ok: true, handled: "saved for the waiting session" });

  // Telegram waits on this response before sending the next update, so the slow
  // part runs after it.
  after(() => handOff(chatId, entry, history));
  return Response.json({ ok: true, handled: "firing Roberts" });
}

function toEntry(message: Message, text: string): ChatMessage {
  return {
    id: message.message_id,
    date: message.date,
    from: "aksels",
    name: message.from?.first_name,
    text,
    replyTo: message.reply_to_message?.text ?? message.reply_to_message?.caption,
  };
}

/**
 * Save the message and decide what happens next: nothing for a Telegram
 * redelivery, nothing more while a session is listening, otherwise start Roberts.
 */
async function save(
  entry: ChatMessage,
): Promise<{ outcome: "duplicate" | "waiting" | "fire"; history: ChatMessage[] }> {
  try {
    const saved = await record([entry]);
    if (!saved.added.length) return { outcome: "duplicate", history: saved.messages };
    return { outcome: (await sessionWaiting()) ? "waiting" : "fire", history: saved.messages };
  } catch (err) {
    // Starting Roberts without the history beats dropping the message.
    console.error("Chat storage failed, handing the message to Roberts without it:", err);
    return { outcome: "fire", history: [entry] };
  }
}

async function handOff(chatId: number, entry: ChatMessage, history: ChatMessage[]) {
  const ack = reply(chatId, "Roberts is on it.");
  try {
    await fireRoberts(fireText(entry, history));
  } catch (err) {
    console.error("Firing Roberts failed:", err);
    await ack;
    await reply(chatId, fireFailureText(err));
  }
  await ack;
}

function reply(chatId: number, text: string): Promise<void> {
  return telegram("sendMessage", { chat_id: chatId, text }).then(
    () => {},
    (err) => console.error("Could not send a Telegram reply:", err),
  );
}

import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import { chatBotToken, defaultChatId, secretMatches, telegram } from "../../../../lib/telegram";

// POST /api/bot/<MCP_SECRET> — Telegram's webhook target for the conversational bot.
//
// Telegram delivers each message here, this asks Claude, and the answer goes back
// to the chat. Nothing polls, so it answers whether or not any machine of yours is
// awake.
//
// Register it by opening /api/webhook-setup/<MCP_SECRET>?confirm=1 in a browser.

export const maxDuration = 60;

const MODEL = "claude-opus-5";

const SYSTEM = `You are Aksels' personal assistant, reached over Telegram from his phone.

Telegram has no markdown rendering here, so write plain text: no asterisks for bold,
no backticks, no markdown headings. Use short paragraphs and, where a list helps,
lines starting with "- ".

Keep answers brief — a phone screen, usually a sentence or two, and at most a short
paragraph unless he asks for detail. Answer directly, without restating the question
or adding a closing offer of further help.

Each message arrives without the earlier conversation, so do not refer to things he
said before unless they are quoted in this message. If a request is unclear, answer
the most likely reading rather than asking what he meant.`;

const anthropic = new Anthropic();

/** Ask Claude and send the answer back, reporting failures into the chat. */
async function answer(chatId: number | string, text: string, quoted?: string) {
  const token = chatBotToken();
  try {
    // A visible "typing…" while the model works; failure here must not lose the reply.
    await telegram("sendChatAction", { chat_id: chatId, action: "typing" }, token).catch(() => {});

    const prompt = quoted
      ? `You sent him this earlier:\n"""\n${quoted}\n"""\n\nHe replied:\n${text}`
      : text;

    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      // Chat on a phone wants an answer now, not a deeper one.
      output_config: { effort: "low" },
      // A policy decline otherwise just stops; this re-runs it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt }],
    });

    const reply =
      response.stop_reason === "refusal"
        ? "I can't help with that one."
        : response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim();

    await telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text: reply || "(no answer came back)",
        disable_web_page_preview: true,
      },
      token,
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Silence would be indistinguishable from the bot being down, so say what broke.
    await telegram(
      "sendMessage",
      { chat_id: chatId, text: `Could not answer: ${detail}`.slice(0, 500) },
      token,
    ).catch(() => {});
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (!secretMatches(secret)) return new Response("Not found", { status: 404 });

  // Set alongside the webhook, so a leaked URL alone cannot feed this endpoint.
  const expectedHeader = process.env.MCP_SECRET;
  const header = req.headers.get("x-telegram-bot-api-secret-token");
  if (expectedHeader && header && header !== expectedHeader) {
    return new Response("Not found", { status: 404 });
  }

  let update: {
    message?: {
      text?: string;
      chat?: { id: number };
      reply_to_message?: { text?: string };
    };
  };
  try {
    update = await req.json();
  } catch {
    return Response.json({ ok: true, skipped: "unparseable body" });
  }

  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat?.id;
  if (!text || chatId === undefined) {
    // Joins, photos, stickers, edits: acknowledge so Telegram stops redelivering.
    return Response.json({ ok: true, skipped: "no text" });
  }

  // Only the owner's chat. Anyone can find a bot by username and start talking to
  // it, and every answer costs real API money, so other chats get one refusal and
  // no model call.
  let allowed: string;
  try {
    allowed = defaultChatId();
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  if (String(chatId) !== String(allowed)) {
    await telegram(
      "sendMessage",
      { chat_id: chatId, text: "This is a private bot." },
      chatBotToken(),
    ).catch(() => {});
    return Response.json({ ok: true, skipped: "chat not allowed" });
  }

  // Return 200 now and answer in the background. Telegram redelivers an update it
  // gets no timely response to, which would otherwise mean duplicate replies for
  // every slow answer.
  const pending = answer(chatId, text, message?.reply_to_message?.text);
  try {
    waitUntil(pending);
  } catch {
    // Outside a Vercel request context waitUntil throws. Awaiting is slower and
    // risks a Telegram retry, but a silent non-answer is worse.
    await pending;
  }
  return Response.json({ ok: true });
}

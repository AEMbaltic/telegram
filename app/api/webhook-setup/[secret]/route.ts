import { chatBotIsSeparate, chatBotToken, secretMatches, telegram } from "../../../../lib/telegram";

// GET /api/webhook-setup/<MCP_SECRET>       — show what registering would do
// GET /api/webhook-setup/<MCP_SECRET>?confirm=1 — register the webhook
// GET /api/webhook-setup/<MCP_SECRET>?remove=1  — unregister it
//
// Meant to be opened in a browser, so setup needs no shell. It is a GET that
// changes state, hence ?confirm=1: a bare visit only reports.

function origin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function GET(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (!secretMatches(secret)) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const webhookUrl = `${origin(req)}/api/bot/${secret}`;
  const separate = chatBotIsSeparate();

  let token: string;
  try {
    token = chatBotToken();
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  try {
    if (url.searchParams.get("remove")) {
      await telegram("deleteWebhook", {}, token);
      return Response.json({
        ok: true,
        removed: true,
        note: "Webhook removed. The chat bot no longer answers; getUpdates works again for this bot.",
      });
    }

    if (!url.searchParams.get("confirm")) {
      const info = (await telegram("getWebhookInfo", {}, token)) as { url?: string };
      return Response.json({
        ok: true,
        action_needed: "Add ?confirm=1 to this URL to register the webhook.",
        would_register: webhookUrl,
        currently_registered: info.url || "(none)",
        chat_bot_has_its_own_token: separate,
        warning: separate
          ? "TELEGRAM_CHAT_BOT_TOKEN is set, so the MCP connector's bot keeps working."
          : "No TELEGRAM_CHAT_BOT_TOKEN, so this registers a webhook on the SAME bot the MCP connector uses. That makes getUpdates return 409 and get_telegram_replies stop working. Set TELEGRAM_CHAT_BOT_TOKEN to a second bot from @BotFather to keep both.",
      });
    }

    await telegram(
      "setWebhook",
      {
        url: webhookUrl,
        // Telegram sends this back on every delivery, so a leaked URL is not enough
        // on its own to post updates into the bot.
        secret_token: secret,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      },
      token,
    );
    const info = (await telegram("getWebhookInfo", {}, token)) as { url?: string };
    return Response.json({
      ok: true,
      registered: info.url,
      chat_bot_has_its_own_token: separate,
      next: "Message the bot on Telegram — it should answer within a few seconds.",
      to_undo: `${origin(req)}/api/webhook-setup/${secret}?remove=1`,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

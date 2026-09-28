# AEM Telegram MCP

Tiny MCP server (Next.js + Vercel `mcp-handler`) that lets Claude send you Telegram
messages and read your replies.

## Tools

- `send_telegram_message(text, chat_id?)` — sends a message to `TELEGRAM_CHAT_ID`.
- `get_telegram_replies(limit?)` — returns messages you sent the bot in the last 24h
  (default 5, max 20). Calling it also marks a session as listening; see below.
- `send_telegram_photo(photo_url, caption?, as_document?, chat_id?)` — sends an image
  Telegram can fetch itself. It takes a URL, not a file.

## Sending a screenshot

A screenshot cannot travel through an MCP tool call: base64 in tool arguments costs
roughly 350 tokens per kilobyte, so a modest PNG would outweigh the conversation
carrying it. A client that holds the file and can run a shell posts it directly
instead, and the bot token stays on the server:

```sh
curl -F photo=@shot.png -F 'caption=captcha on the login page' \
  https://<project>.vercel.app/api/photo/<MCP_SECRET>
```

Fields: `photo` (required), `caption`, and `as_document=1` to skip Telegram's
re-encoding — send screenshots this way, because Telegram recompresses anything sent
as a photo and that smears small text. Replies come back as JSON with `message_id`;
a wrong or missing secret returns `404`.

Note that claude.ai conversations have no browser, so the capture step needs a client
that does — Claude Code, or any script of your own.

## Two-way chat with Roberts

Messaging the bot starts Roberts, a Claude Code routine, so the chat works when no
Claude session is open. Telegram posts each message to the webhook
`/api/bot/<MCP_SECRET>`, which:

1. ignores every chat but `TELEGRAM_CHAT_ID`;
2. saves the message, so `get_telegram_replies` can read it;
3. if `get_telegram_replies` was called in the last 10 minutes, stops there: a
   session is already waiting and will read the message itself;
4. otherwise replies "Roberts is on it." and fires the routine with the new message
   and the 10 before it, including what the bot sent. If the fire fails (the routine
   allows 30 starts an hour), it says so in the chat.

A routine run is a Claude Code session under the subscription. Nothing here calls
the Anthropic API, which bills per message.

Extra environment variables:

| Name | Value |
| --- | --- |
| `ROBERTS_FIRE_URL` | the routine's API trigger, `https://api.anthropic.com/v1/claude_code/routines/<trig_id>/fire` |
| `ROBERTS_FIRE_TOKEN` | the trigger's bearer token |
| `BLOB_READ_WRITE_TOKEN` | set by Vercel when you connect a **private** Blob store (Storage > Create > Blob) to the project |

**Why a Blob store.** A registered webhook makes Telegram's `getUpdates` return 409,
so the webhook is the only thing that sees the messages. They go to
`chat/history.json` (the last 200, both directions) and `get_telegram_replies` reads
them from there. The time of the last `get_telegram_replies` call is
`chat/last-poll.txt`.

**Registration is automatic.** On each cold start of a production deployment,
`instrumentation.ts` checks `getWebhookInfo` and registers the webhook if it points
anywhere else. Registering it copies what `getUpdates` still holds into the history
first, then drops the pending updates so old messages do not start Roberts. It
refuses to register while no Blob store is connected, since `get_telegram_replies`
would then have nothing to read. Preview deployments never register. Runtime logs
show the outcome (`Telegram webhook registered` or why not).

## Deploy

1. In Vercel, **Add New > Project** and import `AEMbaltic/telegram`. Framework is
   auto-detected as Next.js; leave the build settings alone.

   Vercel sets the production branch to the repository's default branch, which is
   `claude/telegram-mcp-connector-hqh9e7` — pushes there deploy to production.

2. **Settings > Environment Variables** (tick Production), then redeploy:

   | Name | Value |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | token from [@BotFather](https://t.me/BotFather) |
   | `TELEGRAM_CHAT_ID` | your chat ID — message the bot, open `https://api.telegram.org/bot<TOKEN>/getUpdates`, use `result[].message.chat.id` |
   | `MCP_SECRET` | a long random string, e.g. `openssl rand -hex 24` |

   Plus the three for the Roberts chat above.

   The variables are read at request time from the deployment's snapshot, so a
   deployment created before they existed will not pick them up. Redeploy after
   adding them.

3. If **Settings > Deployment Protection > Vercel Authentication** is on for
   production, turn it off for the production domain — otherwise Claude gets an
   auth wall instead of the MCP endpoint. (Protection on preview URLs is fine; the
   connector uses the production domain.)

## Connect in Claude

claude.ai > Settings > Connectors > Add custom connector

- Name: `Telegram`
- URL: `https://<your-project>.vercel.app/api/mcp/<MCP_SECRET>`
- Auth: none

Then enable it in the chat.

### Check it before connecting

```sh
curl -sN https://<your-project>.vercel.app/api/mcp/<MCP_SECRET> \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Both tools should come back. A wrong or missing secret returns `404`.

## Security

The secret in the path is the only lock on this endpoint. Anyone holding the URL can
message you and read your recent replies to the bot, so treat it like a password:
keep it out of screenshots, issues, and shared docs. Rotate it by changing
`MCP_SECRET` in Vercel, redeploying, and updating the connector URL.

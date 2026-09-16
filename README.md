# AEM Telegram MCP

Tiny MCP server (Next.js + Vercel `mcp-handler`) that lets Claude send you Telegram
messages and read your replies.

## Tools

- `send_telegram_message(text, chat_id?)` — sends a message to `TELEGRAM_CHAT_ID`.
- `get_telegram_replies(limit?)` — returns messages you sent the bot in the last 24h
  (default 5, max 20).

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

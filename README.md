# AEM Telegram MCP

Tiny MCP server (Next.js + Vercel mcp-handler) that lets Claude send you Telegram messages and read your replies.

## Deploy
1. Push this folder to a GitHub repo (or run `npx vercel` inside it).
2. In Vercel > New Project, import it. Framework: Next.js (auto-detected).
3. Settings > Environment Variables (Production):
   - TELEGRAM_BOT_TOKEN  = token from @BotFather
   - TELEGRAM_CHAT_ID    = your chat ID (open https://api.telegram.org/bot<TOKEN>/getUpdates after sending the bot a message; use message.chat.id)
   - MCP_SECRET          = long random string, e.g. `openssl rand -hex 24`
4. Redeploy.

## Connect in Claude
claude.ai > Settings > Connectors > Add custom connector
- Name: Telegram
- URL: https://<your-project>.vercel.app/api/mcp/<MCP_SECRET>
- Auth: none
Then enable it in the chat.

## Tools
- send_telegram_message(text)
- get_telegram_replies(limit)

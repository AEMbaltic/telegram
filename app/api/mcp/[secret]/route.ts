import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

// Environment variables (set in Vercel > Project > Settings > Environment Variables):
//   TELEGRAM_BOT_TOKEN  - from @BotFather
//   TELEGRAM_CHAT_ID    - the chat the bot should message (your private chat with the bot)
//   MCP_SECRET          - long random string; the endpoint is /api/mcp/<MCP_SECRET>

const TELEGRAM_API = "https://api.telegram.org";

async function telegram(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json: { ok?: boolean; description?: string; result?: unknown };
  try {
    json = JSON.parse(raw);
  } catch {
    // Non-JSON body: an outage page, a proxy, or a network appliance in the way.
    throw new Error(`Telegram ${method} returned HTTP ${res.status} with a non-JSON body: ${raw.slice(0, 200)}`);
  }
  if (!json.ok) throw new Error(`Telegram ${method} failed (HTTP ${res.status}): ${json.description ?? "unknown error"}`);
  return json.result;
}

const mcp = createMcpHandler(
  (server) => {
    server.registerTool(
      "send_telegram_message",
      {
        title: "Send Telegram message",
        description:
          "Send a message to Aksels on Telegram. Use it when you need his input, for example when Google asks 'Confirm it's you'. Plain text; keep it short.",
        inputSchema: z.object({
          text: z.string().min(1).max(4000).describe("Message text"),
          chat_id: z
            .string()
            .optional()
            .describe("Override the default chat ID (normally leave empty)"),
        }),
      },
      async ({ text, chat_id }) => {
        const chatId = chat_id ?? process.env.TELEGRAM_CHAT_ID;
        if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not set");
        const result = (await telegram("sendMessage", {
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        })) as { message_id?: number };
        return {
          content: [
            { type: "text", text: `Sent to Telegram (message_id ${result.message_id ?? "?"}).` },
          ],
        };
      },
    );

    server.registerTool(
      "get_telegram_replies",
      {
        title: "Get recent Telegram replies",
        description:
          "Fetch the latest messages Aksels sent to the bot (last 24h, up to 20). Use after sending a question to read the answer.",
        inputSchema: z.object({
          limit: z.number().int().min(1).max(20).optional().describe("How many messages, default 5"),
        }),
      },
      async ({ limit }) => {
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const updates = (await telegram("getUpdates", { limit: 100 })) as Array<{
          message?: { date: number; text?: string; chat: { id: number }; from?: { first_name?: string } };
        }>;
        const cutoff = Date.now() / 1000 - 24 * 3600;
        const msgs = updates
          .map((u) => u.message)
          .filter((m): m is NonNullable<typeof m> => !!m && !!m.text && m.date >= cutoff)
          .filter((m) => !chatId || String(m.chat.id) === String(chatId))
          .slice(-(limit ?? 5))
          .map((m) => `${new Date(m.date * 1000).toISOString()} ${m.from?.first_name ?? "user"}: ${m.text}`);
        return {
          content: [{ type: "text", text: msgs.length ? msgs.join("\n") : "No replies in the last 24h." }],
        };
      },
    );
  },
  { serverInfo: { name: "aem-telegram-mcp", version: "1.0.0" } },
);

function guard(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  return ctx.params.then(({ secret }) => {
    const expected = process.env.MCP_SECRET;
    if (!expected || secret !== expected) {
      return new Response("Not found", { status: 404 });
    }
    return mcp(req);
  });
}

export const GET = guard;
export const POST = guard;
export const DELETE = guard;

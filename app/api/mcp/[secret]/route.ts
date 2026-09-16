import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { defaultChatId, secretMatches, telegram } from "../../../../lib/telegram";

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
        const result = (await telegram("sendMessage", {
          chat_id: chat_id ?? defaultChatId(),
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
      "send_telegram_photo",
      {
        title: "Send Telegram photo by URL",
        description:
          "Send an image that is already reachable at a public HTTPS URL to Aksels on Telegram. " +
          "Telegram fetches the URL itself, so this cannot send a local file: to send a screenshot " +
          "or any file on disk, POST it to /api/photo/<secret> instead.",
        inputSchema: z.object({
          photo_url: z.string().url().describe("Public HTTPS URL of the image"),
          caption: z.string().max(1024).optional().describe("Optional caption"),
          as_document: z
            .boolean()
            .optional()
            .describe("Send uncompressed, preserving small text (default false)"),
          chat_id: z
            .string()
            .optional()
            .describe("Override the default chat ID (normally leave empty)"),
        }),
      },
      async ({ photo_url, caption, as_document, chat_id }) => {
        const asDocument = as_document ?? false;
        const result = (await telegram(asDocument ? "sendDocument" : "sendPhoto", {
          chat_id: chat_id ?? defaultChatId(),
          [asDocument ? "document" : "photo"]: photo_url,
          ...(caption ? { caption } : {}),
        })) as { message_id?: number };
        return {
          content: [
            { type: "text", text: `Sent image to Telegram (message_id ${result.message_id ?? "?"}).` },
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
  { serverInfo: { name: "aem-telegram-mcp", version: "1.1.0" } },
);

function guard(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  return ctx.params.then(({ secret }) => {
    if (!secretMatches(secret)) {
      return new Response("Not found", { status: 404 });
    }
    return mcp(req);
  });
}

export const GET = guard;
export const POST = guard;
export const DELETE = guard;

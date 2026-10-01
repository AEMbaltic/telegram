// Shared Telegram client. Environment variables (set in Vercel > Project > Settings
// > Environment Variables):
//   TELEGRAM_BOT_TOKEN  - from @BotFather
//   TELEGRAM_CHAT_ID    - the chat the bot should message (your private chat with the bot)
//   MCP_SECRET          - long random string guarding every route under /api/*/<secret>

const TELEGRAM_API = "https://api.telegram.org";

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

export function defaultChatId(): string {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not set");
  return chatId;
}

/** True when `secret` matches MCP_SECRET. An unset secret matches nothing. */
export function secretMatches(secret: string): boolean {
  const expected = process.env.MCP_SECRET;
  return !!expected && secret === expected;
}

async function unwrap(res: Response, method: string): Promise<unknown> {
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

/** Call a Bot API method with a JSON body. */
export async function telegram(method: string, body: Record<string, unknown>, token?: string) {
  const res = await fetch(`${TELEGRAM_API}/bot${token ?? botToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap(res, method);
}

/**
 * Download a file someone sent the bot. The file URL carries the bot token, so it
 * never goes into an error message or a log.
 */
export async function downloadFile(fileId: string): Promise<{ bytes: Blob; filePath: string }> {
  const file = (await telegram("getFile", { file_id: fileId })) as { file_path?: string };
  if (!file.file_path) throw new Error("Telegram getFile returned no file_path");
  const res = await fetch(`${TELEGRAM_API}/file/bot${botToken()}/${file.file_path}`);
  if (!res.ok) throw new Error(`Telegram file download failed (HTTP ${res.status})`);
  return { bytes: await res.blob(), filePath: file.file_path };
}

/**
 * Upload image bytes to a chat.
 *
 * `asDocument` sends the file uncompressed. Telegram re-encodes anything sent as a
 * photo, which smears small text, so screenshots of a browser window stay readable
 * only as a document.
 */
export async function sendImage(
  bytes: Blob,
  filename: string,
  opts: { chatId?: string; caption?: string; asDocument?: boolean } = {},
) {
  const asDocument = opts.asDocument ?? false;
  const method = asDocument ? "sendDocument" : "sendPhoto";
  const form = new FormData();
  form.append("chat_id", opts.chatId ?? defaultChatId());
  form.append(asDocument ? "document" : "photo", bytes, filename);
  if (opts.caption) form.append("caption", opts.caption.slice(0, 1024));
  const res = await fetch(`${TELEGRAM_API}/bot${botToken()}/${method}`, { method: "POST", body: form });
  return unwrap(res, method) as Promise<{ message_id?: number }>;
}

/** Upload an audio file (mp3) to a chat as a voice message. */
export async function sendVoice(bytes: Blob, opts: { chatId?: string } = {}) {
  const form = new FormData();
  form.append("chat_id", opts.chatId ?? defaultChatId());
  form.append("voice", bytes, "roberts.mp3");
  const res = await fetch(`${TELEGRAM_API}/bot${botToken()}/sendVoice`, { method: "POST", body: form });
  return unwrap(res, "sendVoice") as Promise<{ message_id?: number }>;
}

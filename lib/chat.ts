import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from "@vercel/blob";

// The chat with Aksels, kept in a private Vercel Blob store (connecting the store
// sets BLOB_READ_WRITE_TOKEN).
//
// A webhook makes Telegram's getUpdates return 409, so once /api/bot receives the
// messages nothing else can read them from Telegram. Everything the webhook gets
// is written here, and get_telegram_replies reads it back.
//
// Vercel Hobby allows 2,000 advanced Blob operations (put, list, copy) a month.
// This never lists and uses two fixed names, so the only advanced operations are
// one put per message from Aksels and at most one per minute of polling.

const HISTORY = "chat/history.json";
const LAST_POLL = "chat/last-poll.txt";
const KEEP = 200;

/** A session that read replies this recently is still listening for more. */
export const WAITING_MS = 10 * 60 * 1000;

export type ChatMessage = {
  /** Telegram message_id. */
  id: number;
  /** Unix seconds, as Telegram reports it. */
  date: number;
  from: "aksels";
  name?: string;
  text: string;
  /** Text of the bot message he replied to, if he used Telegram's reply. */
  replyTo?: string;
};

export function storageConfigured(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function readHistory(): Promise<{ messages: ChatMessage[]; etag?: string }> {
  const res = await get(HISTORY, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200) return { messages: [] };
  return { messages: JSON.parse(await new Response(res.stream).text()), etag: res.blob.etag };
}

export async function history(): Promise<ChatMessage[]> {
  return (await readHistory()).messages;
}

/**
 * Add messages not already stored. Returns the ones that were new, so a Telegram
 * redelivery can be told apart from a fresh message, and the history after the write.
 */
export async function record(
  incoming: ChatMessage[],
): Promise<{ added: ChatMessage[]; messages: ChatMessage[] }> {
  for (let attempt = 1; ; attempt++) {
    const { messages, etag } = await readHistory();
    const seen = new Set(messages.map((m) => m.id));
    const added = incoming.filter((m) => !seen.has(m.id));
    if (!added.length) return { added, messages };

    // Telegram dates have one-second resolution; ids are the true order.
    const next = [...messages, ...added].sort((a, b) => a.id - b.id).slice(-KEEP);
    try {
      await put(HISTORY, JSON.stringify(next), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        // Only overwrite the version just read, so two writers cannot drop each
        // other's message; the loser re-reads and tries again.
        ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }),
      });
      return { added, messages: next };
    } catch (err) {
      const lostRace = err instanceof BlobPreconditionFailedError || !etag;
      if (!lostRace || attempt >= 5) throw err;
    }
  }
}

export async function lastPolledAt(): Promise<number | null> {
  try {
    return (await head(LAST_POLL)).uploadedAt.getTime();
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

/** Note that a session just read replies, so new messages go to it rather than to a new Roberts. */
export async function markPolled() {
  const last = await lastPolledAt();
  // Writes are the metered Blob operation; minute resolution is plenty for a
  // ten-minute window.
  if (last !== null && Date.now() - last < 60_000) return;
  await put(LAST_POLL, new Date().toISOString(), {
    access: "private",
    contentType: "text/plain",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function sessionWaiting(): Promise<boolean> {
  const last = await lastPolledAt();
  return last !== null && Date.now() - last < WAITING_MS;
}

export function formatLine(m: ChatMessage, maxText = Infinity): string {
  const who = m.name ?? "Aksels";
  const text = m.text.length > maxText ? `${m.text.slice(0, maxText)}…` : m.text;
  return `${new Date(m.date * 1000).toISOString()} ${who}: ${text}`;
}

import { formatLine, type ChatMessage } from "./chat";

// Hands a Telegram message to Roberts, a Claude Code routine, by firing its API
// trigger. The run is a Claude session under Aksels' subscription, not a
// per-message Anthropic API call.
//
//   ROBERTS_FIRE_URL    the routine's /fire endpoint
//   ROBERTS_FIRE_TOKEN  its bearer token

const CONTEXT_MESSAGES = 10;

export class FireError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The new message, then the ones before it so Roberts knows what "yes" answers. */
export function fireText(message: ChatMessage, history: ChatMessage[]): string {
  const earlier = history.filter((m) => m.id < message.id).slice(-CONTEXT_MESSAGES);
  const parts = [`New Telegram message from Aksels:\n${message.text}`];
  if (message.replyTo) parts.push(`He was replying to this bot message:\n${message.replyTo}`);
  if (earlier.length) {
    const heading =
      earlier.length === 1 ? "The message before it:" : `The last ${earlier.length} messages before it, oldest first:`;
    parts.push(`${heading}\n${earlier.map((m) => formatLine(m, 1000)).join("\n")}`);
  }
  return parts.join("\n\n");
}

export async function fireRoberts(text: string): Promise<void> {
  const url = process.env.ROBERTS_FIRE_URL;
  const token = process.env.ROBERTS_FIRE_TOKEN;
  if (!url || !token) throw new FireError("ROBERTS_FIRE_URL or ROBERTS_FIRE_TOKEN is not set in Vercel.");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    throw new FireError(`the request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new FireError(`HTTP ${res.status}${body ? `: ${body}` : ""}`, res.status);
  }
}

/** What Aksels reads when Roberts could not be started. */
export function fireFailureText(err: unknown): string {
  const saved = "Your message is saved and goes along with your next one.";
  if (err instanceof FireError && err.status === 429) {
    return `Roberts could not start: too many starts (HTTP 429; the limit is 30 an hour). ${saved}`;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Roberts could not start: ${detail}`.slice(0, 600) + `\n${saved}`;
}

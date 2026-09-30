import { downloadFile } from "./telegram";

// Turns a Telegram voice note, audio file or round video into text with Groq's
// Whisper, so it can go to Roberts like a typed message.
//
//   GROQ_API_KEY  from console.groq.com

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// No language is set on purpose: Aksels mixes Latvian and English in one note.
const PROMPT = "Latvian and English. Names: Aksels, Roberts, AEM Baltic, Mandrelekids, Google Ads, Meta, Vercel, Lovable.";

export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_SECONDS = 10 * 60;

/** The parts of message.voice / .audio / .video_note this needs. */
export type Recording = { file_id: string; duration?: number; file_size?: number };

export function tooLong(r: Recording): boolean {
  return (r.file_size ?? 0) > MAX_BYTES || (r.duration ?? 0) > MAX_SECONDS;
}

export async function transcribe(r: Recording, kind: "voice" | "audio" | "video_note"): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const { bytes, filePath } = await downloadFile(r.file_id);
  // Voice notes are Opus in Ogg. Audio files and round videos keep their own
  // extension (mp3, m4a, mp4), since Whisper reads the format from the filename.
  const ext = filePath.match(/\.([a-z0-9]+)$/i)?.[1];
  const filename = kind === "voice" || !ext ? "voice.ogg" : `voice.${ext}`;

  const form = new FormData();
  form.append("file", bytes, filename);
  form.append("model", "whisper-large-v3");
  form.append("response_format", "text");
  form.append("temperature", "0");
  form.append("prompt", PROMPT);

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Groq transcription failed (HTTP ${res.status})${body ? `: ${body}` : ""}`);
  }
  const text = (await res.text()).trim();
  if (!text) throw new Error("Groq returned an empty transcript");
  return text;
}

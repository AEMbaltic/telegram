// Turns text into speech with Groq's Orpheus model, so Roberts can reply with a
// voice message. Uses the same key as the voice transcription in voice.ts.
//
//   GROQ_API_KEY  from console.groq.com (accept the Orpheus model terms there once)

const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";
const MODEL = "canopylabs/orpheus-v1-english";
const VOICE = "daniel";

/** Groq limits one Orpheus request to 200 characters. */
export const MAX_TTS_CHARS = 200;

export async function speak(text: string): Promise<Blob> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const res = await fetch(GROQ_TTS_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, response_format: "mp3" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Groq speech failed (HTTP ${res.status})${body ? `: ${body}` : ""}`);
  }
  return new Blob([await res.arrayBuffer()], { type: "audio/mpeg" });
}

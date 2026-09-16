import { secretMatches, sendImage } from "../../../../lib/telegram";

// POST /api/photo/<MCP_SECRET>
//
// Pushes an image straight to Telegram. This exists because a screenshot cannot
// travel through an MCP tool call: base64 in tool arguments costs roughly 350
// tokens per kilobyte, so a modest PNG would outweigh the whole conversation.
// Anything holding the file and a shell posts it here instead, and the bot token
// stays on the server.
//
//   curl -F photo=@shot.png -F caption='captcha on the login page' \
//     https://<project>.vercel.app/api/photo/<MCP_SECRET>
//
// Fields: photo (required, the file), caption (optional),
//         as_document ("1"/"true" to skip Telegram's re-encoding).

export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  if (!secretMatches(secret)) return new Response("Not found", { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { ok: false, error: "Send multipart/form-data with a 'photo' file field." },
      { status: 400 },
    );
  }

  const photo = form.get("photo");
  if (!(photo instanceof Blob)) {
    return Response.json({ ok: false, error: "Missing 'photo' file field." }, { status: 400 });
  }
  if (photo.size === 0) {
    return Response.json({ ok: false, error: "'photo' is empty." }, { status: 400 });
  }

  const caption = form.get("caption");
  const asDocument = form.get("as_document");
  const filename = photo instanceof File && photo.name ? photo.name : "screenshot.png";

  try {
    const result = await sendImage(photo, filename, {
      caption: typeof caption === "string" ? caption : undefined,
      asDocument: asDocument === "1" || asDocument === "true",
    });
    return Response.json({ ok: true, message_id: result.message_id ?? null });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

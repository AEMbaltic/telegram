// Runs once per server instance, before it serves requests.
export async function register() {
  // Preview deployments must not take the webhook away from production.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.VERCEL_ENV !== "production") return;
  const { ensureWebhook } = await import("./lib/webhook");
  try {
    await ensureWebhook();
  } catch (err) {
    console.error("Telegram webhook check failed:", err);
  }
}

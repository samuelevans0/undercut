import { json } from "../lib/http.js";
import { verifyPollRequest } from "../lib/hmac-auth.js";
import { getAdapter } from "../sources/index.js";
import { pollSource } from "../poll.js";

export async function routePoll(request, env, url, path) {
  const m = path.match(/^\/api\/poll\/([a-z0-9_-]+)$/i);
  if (!m) return null;
  const sourceId = m[1];

  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const timestamp = request.headers.get("x-uc-timestamp");
  const signature = request.headers.get("x-uc-signature");
  const ok = await verifyPollRequest(env.POLL_SECRET, sourceId, timestamp, signature);
  if (!ok) return json({ error: "unauthorized" }, 401);

  if (!getAdapter(sourceId)) return json({ error: "unknown source" }, 404);

  const result = await pollSource(env, sourceId, Math.floor(Date.now() / 1000));
  if (result.status === "not-due") return new Response(null, { status: 204 });
  return json(result);
}

import { json, readJson } from "../lib/http.js";
import { addPushSub, removePushSub } from "../db/prefs.js";

export async function routePush(request, env, url, path) {
  if (path === "/api/push/key" && request.method === "GET") {
    return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
  }

  if (path === "/api/push/subscribe" && request.method === "POST") {
    const body = await readJson(request);
    const endpoint = body.endpoint;
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || !p256dh || !auth) {
      return json({ error: "invalid subscription" }, 400);
    }
    await addPushSub(env.DB, { endpoint, p256dh, auth }, Math.floor(Date.now() / 1000));
    return json({ ok: true });
  }

  if (path === "/api/push/unsubscribe" && request.method === "POST") {
    const { endpoint } = await readJson(request);
    if (typeof endpoint !== "string") return json({ error: "endpoint required" }, 400);
    await removePushSub(env.DB, endpoint);
    return json({ ok: true });
  }

  return null;
}

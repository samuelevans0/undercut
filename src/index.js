import { json, checkOrigin, HttpError } from "./lib/http.js";
import { routePoll } from "./api/poll.js";
import { routeAuth, requireSession } from "./api/auth.js";
import { routeFeed } from "./api/feed.js";
import { routeSettings } from "./api/settings.js";
import { routePush } from "./api/push.js";

const OPEN_PREFIXES = ["/api/auth/", "/api/health"];
const browserRouters = [routeAuth, routeFeed, routeSettings, routePush];

async function handleApi(request, env, url, path) {
  if (path === "/api/health") return json({ ok: true });

  // Machine endpoints: own auth, no origin check, no session.
  if (path.startsWith("/api/poll/")) {
    const res = await routePoll(request, env, url, path);
    if (res) return res;
    return json({ error: "not found" }, 404);
  }

  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && !checkOrigin(request)) {
    return json({ error: "origin check failed" }, 403);
  }

  if (!OPEN_PREFIXES.some((p) => path.startsWith(p))) {
    await requireSession(request, env);
  }

  for (const route of browserRouters) {
    const res = await route(request, env, url, path);
    if (res) return res;
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : url.pathname;
    try {
      if (path.startsWith("/api/")) return await handleApi(request, env, url, path);
      return env.ASSETS ? await env.ASSETS.fetch(request) : new Response("not found", { status: 404 });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error("unhandled error", e);
      return json({ error: "internal error" }, 500);
    }
  },
};

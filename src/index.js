import { json, HttpError } from "./lib/http.js";
import { routePoll } from "./api/poll.js";

const routers = [routePoll];

async function handleApi(request, env, url, path) {
  if (path === "/api/health") return json({ ok: true });
  for (const route of routers) {
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

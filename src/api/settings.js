import { json, readJson } from "../lib/http.js";
import { getPrefs, setPrefs, listWatchlist, listRules } from "../db/prefs.js";
import { listSources } from "../db/sources.js";

const VALID_OPS = ["lt", "lte", "gt", "gte", "eq"];

function publicPrefs(prefs) {
  const { password_hash, ...safe } = prefs;
  return safe;
}

export async function routeSettings(request, env, url, path) {
  if (path === "/api/settings" && request.method === "GET") {
    return json({ prefs: publicPrefs(await getPrefs(env.DB)), sources: await listSources(env.DB) });
  }

  if (path === "/api/settings" && request.method === "PATCH") {
    const body = await readJson(request);
    const patch = {};
    if (body.notify_threshold !== undefined) {
      const n = Number(body.notify_threshold);
      if (!Number.isInteger(n) || n < 0 || n > 100) return json({ error: "threshold must be 0 to 100" }, 400);
      patch.notify_threshold = n;
    }
    if (body.weights !== undefined) {
      if (typeof body.weights !== "object" || body.weights === null) return json({ error: "invalid weights" }, 400);
      patch.weights_json = JSON.stringify(body.weights);
    }
    await setPrefs(env.DB, patch);
    return json({ ok: true });
  }

  if (path === "/api/watchlist" && request.method === "GET") {
    return json({ watchlist: await listWatchlist(env.DB) });
  }

  if (path === "/api/watchlist" && request.method === "POST") {
    const { label, query, maxPriceCents } = await readJson(request);
    if (typeof query !== "string" || !query.trim()) return json({ error: "query required" }, 400);
    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB
      .prepare("INSERT INTO watchlist (label, query, max_price_cents, created_at) VALUES (?,?,?,?)")
      .bind(String(label ?? query).slice(0, 80), query.trim(), maxPriceCents ?? null, now)
      .run();
    return json({ ok: true, id: res.meta.last_row_id });
  }

  let m = path.match(/^\/api\/watchlist\/(\d+)$/);
  if (m && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM watchlist WHERE id = ?").bind(parseInt(m[1], 10)).run();
    return json({ ok: true });
  }

  if (path === "/api/rules" && request.method === "GET") {
    return json({ rules: await listRules(env.DB) });
  }

  if (path === "/api/rules" && request.method === "POST") {
    const { label, category, predicate } = await readJson(request);
    if (!Array.isArray(predicate) || !predicate.length) return json({ error: "predicate must be a non-empty array" }, 400);
    for (const clause of predicate) {
      if (!clause || typeof clause.field !== "string" || !VALID_OPS.includes(clause.op)) {
        return json({ error: "invalid predicate clause" }, 400);
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB
      .prepare("INSERT INTO rules (label, category, predicate_json, created_at) VALUES (?,?,?,?)")
      .bind(String(label ?? "rule").slice(0, 80), String(category ?? "*"), JSON.stringify(predicate), now)
      .run();
    return json({ ok: true, id: res.meta.last_row_id });
  }

  m = path.match(/^\/api\/rules\/(\d+)$/);
  if (m && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(parseInt(m[1], 10)).run();
    return json({ ok: true });
  }

  m = path.match(/^\/api\/sources\/([a-z0-9_-]+)\/enable$/i);
  if (m && request.method === "POST") {
    await env.DB
      .prepare("UPDATE sources SET enabled = 1, consecutive_failures = 0, disabled_at = NULL WHERE id = ?")
      .bind(m[1])
      .run();
    return json({ ok: true });
  }

  return null;
}

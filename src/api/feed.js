import { json } from "../lib/http.js";
import { listFeed, getDeal, listEvents } from "../db/deals.js";
import { getReference } from "../db/refs.js";
import { LIMITS } from "../config.js";

function withReasons(row) {
  let reasons = [];
  try {
    reasons = JSON.parse(row.score_reasons_json ?? "[]");
  } catch { /* leave empty */ }
  const { score_reasons_json, ...rest } = row;
  return { ...rest, reasons };
}

export async function routeFeed(request, env, url, path) {
  if (path === "/api/feed" && request.method === "GET") {
    // Clamp both, and clamp the low end too. SQLite treats a negative LIMIT as
    // unbounded, so `?limit=-1` would otherwise return the whole table.
    const rawMin = parseInt(url.searchParams.get("minScore") ?? "0", 10);
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const minScore = Number.isFinite(rawMin) ? Math.min(100, Math.max(0, rawMin)) : 0;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, LIMITS.maxFeedRows)
      : 100;
    const rows = await listFeed(env.DB, { minScore, limit });
    return json({ deals: rows.map(withReasons) });
  }

  const m = path.match(/^\/api\/deal\/(\d+)$/);
  if (m && request.method === "GET") {
    const deal = await getDeal(env.DB, parseInt(m[1], 10));
    if (!deal) return json({ error: "not found" }, 404);
    const events = await listEvents(env.DB, deal.id);
    const reference = await getReference(env.DB, deal.spec_key);
    // Take the sanitised row, not the original. Destructuring only `reasons`
    // and returning `deal` would ship the raw score_reasons_json text column
    // alongside the parsed array, which is exactly what withReasons exists to
    // prevent and what the feed route already avoids.
    const { reasons, ...safeDeal } = withReasons(deal);
    return json({ deal: safeDeal, reasons, events, reference });
  }

  return null;
}

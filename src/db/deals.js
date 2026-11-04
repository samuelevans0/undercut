import { LIMITS } from "../config.js";

// A re-poll that finds a listing byte-identical to what's already stored is
// the common case (a source's top items barely change minute to minute), so
// only touch the row when something real changed. last_seen_at still gets
// refreshed periodically even with no other change, so the feed's "still
// live" ordering doesn't go stale between real updates.
const STALE_TOUCH_SEC = 20 * 60;

export async function upsertDeal(db, deal, nowSec) {
  const existing = await db
    .prepare("SELECT * FROM deals WHERE fingerprint = ?")
    .bind(deal.fingerprint)
    .first();

  if (existing) {
    const specsJson = JSON.stringify(deal.specs ?? {});
    const changed =
      existing.title !== deal.title ||
      existing.url !== deal.url ||
      (existing.merchant ?? null) !== (deal.merchant ?? null) ||
      existing.condition !== (deal.condition ?? "new") ||
      existing.price_cents !== deal.priceCents ||
      (existing.was_price_cents ?? null) !== (deal.wasPriceCents ?? null) ||
      existing.category !== (deal.category ?? "unknown") ||
      (existing.spec_key ?? null) !== (deal.specKey ?? null) ||
      existing.specs_json !== specsJson;

    if (!changed && nowSec - existing.last_seen_at < STALE_TOUCH_SEC) {
      return { id: existing.id, isNew: false, previousPriceCents: existing.price_cents, changed: false };
    }

    if (changed) {
      await db
        .prepare(
          "UPDATE deals SET title = ?, url = ?, merchant = ?, condition = ?, price_cents = ?, " +
            "was_price_cents = ?, category = ?, spec_key = ?, specs_json = ?, last_seen_at = ? WHERE id = ?"
        )
        .bind(
          deal.title, deal.url, deal.merchant ?? null, deal.condition ?? "new", deal.priceCents,
          deal.wasPriceCents ?? null, deal.category ?? "unknown", deal.specKey ?? null,
          specsJson, nowSec, existing.id
        )
        .run();
    } else {
      await db.prepare("UPDATE deals SET last_seen_at = ? WHERE id = ?").bind(nowSec, existing.id).run();
    }
    return { id: existing.id, isNew: false, previousPriceCents: existing.price_cents, changed };
  }

  const res = await db
    .prepare(
      "INSERT INTO deals (fingerprint, source_id, external_id, title, url, merchant, condition, " +
        "price_cents, was_price_cents, currency, category, spec_key, specs_json, posted_at, " +
        "first_seen_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(
      deal.fingerprint, deal.sourceId, deal.externalId ?? null, deal.title, deal.url,
      deal.merchant ?? null, deal.condition ?? "new", deal.priceCents, deal.wasPriceCents ?? null,
      deal.currency ?? "USD", deal.category ?? "unknown", deal.specKey ?? null,
      JSON.stringify(deal.specs ?? {}), deal.postedAt ?? null, nowSec, nowSec
    )
    .run();
  return { id: res.meta.last_row_id, isNew: true, previousPriceCents: null, changed: true };
}

export async function getLastEvent(db, dealId) {
  return db
    .prepare("SELECT * FROM deal_events WHERE deal_id = ? ORDER BY seen_at DESC LIMIT 1")
    .bind(dealId)
    .first();
}

export async function appendEvent(db, dealId, { priceCents, upvotes = null, comments = null }, nowSec) {
  const last = await getLastEvent(db, dealId);
  if (last && last.price_cents === priceCents && (last.upvotes ?? null) === upvotes && (last.comments ?? null) === comments) {
    return { inserted: false };
  }
  await db
    .prepare("INSERT INTO deal_events (deal_id, seen_at, price_cents, upvotes, comments) VALUES (?,?,?,?,?)")
    .bind(dealId, nowSec, priceCents, upvotes, comments)
    .run();
  return { inserted: true };
}

export async function getDeal(db, id) {
  return db.prepare("SELECT * FROM deals WHERE id = ?").bind(id).first();
}

export async function listEvents(db, dealId) {
  const { results } = await db
    .prepare("SELECT * FROM deal_events WHERE deal_id = ? ORDER BY seen_at ASC")
    .bind(dealId)
    .all();
  return results ?? [];
}

export async function listFeed(db, { limit = 100, minScore = 0 } = {}) {
  const capped = Math.min(limit, LIMITS.maxFeedRows);
  const { results } = await db
    .prepare("SELECT * FROM deals WHERE score >= ? ORDER BY last_seen_at DESC LIMIT ?")
    .bind(minScore, capped)
    .all();
  return results ?? [];
}

export async function setScore(db, id, score, reasons) {
  const reasonsJson = JSON.stringify(reasons ?? []);
  const existing = await db.prepare("SELECT score, score_reasons_json FROM deals WHERE id = ?").bind(id).first();
  if (existing && existing.score === score && existing.score_reasons_json === reasonsJson) {
    return { updated: false };
  }
  await db
    .prepare("UPDATE deals SET score = ?, score_reasons_json = ? WHERE id = ?")
    .bind(score, reasonsJson, id)
    .run();
  return { updated: true };
}

export async function markNotified(db, id, priceCents, nowSec) {
  await db
    .prepare("UPDATE deals SET notified_at = ?, notified_price_cents = ? WHERE id = ?")
    .bind(nowSec, priceCents, id)
    .run();
}

import { LIMITS } from "../config.js";

export async function upsertDeal(db, deal, nowSec) {
  const existing = await db
    .prepare("SELECT id, price_cents FROM deals WHERE fingerprint = ?")
    .bind(deal.fingerprint)
    .first();

  if (existing) {
    await db
      .prepare(
        "UPDATE deals SET title = ?, url = ?, merchant = ?, condition = ?, price_cents = ?, " +
          "was_price_cents = ?, category = ?, spec_key = ?, specs_json = ?, last_seen_at = ? WHERE id = ?"
      )
      .bind(
        deal.title, deal.url, deal.merchant ?? null, deal.condition ?? "new", deal.priceCents,
        deal.wasPriceCents ?? null, deal.category ?? "unknown", deal.specKey ?? null,
        JSON.stringify(deal.specs ?? {}), nowSec, existing.id
      )
      .run();
    return { id: existing.id, isNew: false, previousPriceCents: existing.price_cents };
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
  return { id: res.meta.last_row_id, isNew: true, previousPriceCents: null };
}

export async function appendEvent(db, dealId, { priceCents, upvotes = null, comments = null }, nowSec) {
  await db
    .prepare("INSERT INTO deal_events (deal_id, seen_at, price_cents, upvotes, comments) VALUES (?,?,?,?,?)")
    .bind(dealId, nowSec, priceCents, upvotes, comments)
    .run();
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
  await db
    .prepare("UPDATE deals SET score = ?, score_reasons_json = ? WHERE id = ?")
    .bind(score, JSON.stringify(reasons ?? []), id)
    .run();
}

export async function markNotified(db, id, priceCents, nowSec) {
  await db
    .prepare("UPDATE deals SET notified_at = ?, notified_price_cents = ? WHERE id = ?")
    .bind(nowSec, priceCents, id)
    .run();
}

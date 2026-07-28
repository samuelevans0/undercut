import { getAdapter } from "./sources/index.js";
import { parseTitle } from "./core/parse-title.js";
import { classify } from "./core/classify.js";
import { fingerprint } from "./core/fingerprint.js";
import { scoreDeal } from "./core/score.js";
import { evaluateRules } from "./core/rules.js";
import { shouldNotify, buildNotification } from "./core/notify-decision.js";
import { getSource, isDue, markPolled, markSuccess, markFailure } from "./db/sources.js";
import { upsertDeal, appendEvent, getDeal, setScore } from "./db/deals.js";
import { getReference, updateLearned } from "./db/refs.js";
import { getPrefs, listWatchlist, listRules } from "./db/prefs.js";
import { notifyDeal } from "./notify.js";
import { CATEGORY_WEIGHTS, SOURCE_HEAT_BASELINE } from "./config.js";
import seedJson from "../seed/reference-prices.json";

const SOURCE_LABELS = {
  reddit: "r/buildapcsales",
  slickdeals: "Slickdeals",
  woot: "Woot",
  ebay: "eBay",
};

function heatFor(sourceId, item, nowSec) {
  const baseline = SOURCE_HEAT_BASELINE[sourceId] ?? 0;
  if (!baseline || item.upvotes === null) return null;
  const ageSec = nowSec - (item.postedAt ?? nowSec);
  // A post under a minute old has no meaningful velocity yet: dividing by a
  // floored 1-minute denominator (the previous approach) doesn't just dodge
  // divide-by-zero, it manufactures a rate from a near-zero window, which
  // reads as instant virality for any post that is merely fresh. Treat it as
  // no signal (scoreDeal already tolerates null heat) until real time has
  // elapsed to measure a rate against the source baseline.
  if (ageSec < 60) return null;
  const ageMin = ageSec / 60;
  const velocity = ((item.upvotes ?? 0) + (item.comments ?? 0)) / ageMin;
  return { velocity, baseline };
}

async function refreshLearned(db, specKey, category, nowSec) {
  const { results } = await db
    .prepare("SELECT price_cents FROM deals WHERE spec_key = ? ORDER BY last_seen_at DESC LIMIT 100")
    .bind(specKey)
    .all();
  const prices = (results ?? []).map((r) => r.price_cents);
  await updateLearned(db, specKey, category, prices, seedJson, nowSec);
}

export async function pollSource(env, sourceId, nowSec, deps = {}) {
  const { fetchImpl = fetch, sendImpl } = deps;

  const adapter = getAdapter(sourceId);
  if (!adapter) return { status: "unknown-source", seen: 0, stored: 0, notified: 0, skipped: 0 };

  const source = await getSource(env.DB, sourceId);
  if (!source) return { status: "unknown-source", seen: 0, stored: 0, notified: 0, skipped: 0 };
  if (!isDue(source, nowSec)) return { status: "not-due", seen: 0, stored: 0, notified: 0, skipped: 0 };

  await markPolled(env.DB, sourceId, nowSec);

  let config = {};
  try {
    config = JSON.parse(source.config_json ?? "{}");
  } catch {
    config = {};
  }

  const prefs = await getPrefs(env.DB);
  const watchlist = await listWatchlist(env.DB);
  const rules = await listRules(env.DB);

  // eBay searches one watchlist query per poll to stay inside its daily budget.
  if (sourceId === "ebay") {
    config.queries = watchlist.map((w) => w.query).filter(Boolean);
    config.cursor = Number.isFinite(config.cursor) ? config.cursor : 0;
  }

  let items;
  try {
    items = await adapter.list(env, config, fetchImpl);
  } catch (e) {
    await markFailure(env.DB, sourceId, nowSec, e.message);
    return { status: "failed", seen: 0, stored: 0, notified: 0, skipped: 0, error: e.message };
  }

  let weights = CATEGORY_WEIGHTS;
  try {
    const custom = JSON.parse(prefs.weights_json ?? "{}");
    if (custom && typeof custom === "object") weights = { ...CATEGORY_WEIGHTS, ...custom };
  } catch { /* keep defaults */ }

  let stored = 0;
  let skipped = 0;
  let notified = 0;
  const touchedSpecs = new Map();

  for (const item of items) {
    const parsed = parseTitle(item.rawTitle);
    if (parsed.priceCents === null) { skipped++; continue; }

    const { category, specKey, specs } = classify(parsed.cleanTitle, { tag: item.tag });
    const fp = await fingerprint({ cleanTitle: parsed.cleanTitle, merchant: parsed.merchant, category, specKey });

    const { id } = await upsertDeal(env.DB, {
      fingerprint: fp,
      sourceId,
      externalId: item.externalId,
      title: parsed.cleanTitle || item.rawTitle,
      url: item.url,
      merchant: parsed.merchant,
      condition: parsed.condition,
      priceCents: parsed.priceCents,
      wasPriceCents: parsed.wasPriceCents,
      category,
      specKey,
      specs,
      postedAt: item.postedAt,
    }, nowSec);
    stored++;

    await appendEvent(env.DB, id, {
      priceCents: parsed.priceCents,
      upvotes: item.upvotes,
      comments: item.comments,
    }, nowSec);

    if (specKey) touchedSpecs.set(specKey, category);

    const refRow = await getReference(env.DB, specKey);
    const reference = refRow ? { typicalCents: refRow.typical_cents, floorCents: refRow.floor_cents } : null;

    const scored = scoreDeal({
      priceCents: parsed.priceCents,
      wasPriceCents: parsed.wasPriceCents,
      category,
      condition: parsed.condition,
      reference,
      heat: heatFor(sourceId, item, nowSec),
      sellerRating: item.sellerRating,
      weights,
    });
    await setScore(env.DB, id, scored.score, scored.reasons);

    const dealRow = await getDeal(env.DB, id);
    const ruled = evaluateRules(
      { cleanTitle: parsed.cleanTitle, category, specKey, priceCents: parsed.priceCents, condition: parsed.condition, specs },
      watchlist,
      rules
    );

    const decision = shouldNotify({
      score: scored.score,
      threshold: prefs.notify_threshold,
      forceNotify: ruled.forceNotify,
      notifiedAt: dealRow.notified_at,
      notifiedPriceCents: dealRow.notified_price_cents,
      priceCents: parsed.priceCents,
    });

    if (decision.notify) {
      const payload = buildNotification({
        deal: dealRow,
        reference,
        sourceName: SOURCE_LABELS[sourceId] ?? sourceId,
        matches: ruled.matches,
        nowSec,
      });
      const res = await notifyDeal(env, dealRow, payload, nowSec, sendImpl);
      if (res.sent > 0) notified++;
    }
  }

  for (const [specKey, category] of touchedSpecs) {
    await refreshLearned(env.DB, specKey, category, nowSec);
  }

  if (sourceId === "ebay" && config.queries?.length) {
    config.cursor = (config.cursor + 1) % config.queries.length;
    await env.DB
      .prepare("UPDATE sources SET config_json = ? WHERE id = 'ebay'")
      .bind(JSON.stringify({ ...config, queries: undefined }))
      .run();
  }

  await markSuccess(env.DB, sourceId, nowSec);
  return { status: "ok", seen: items.length, stored, notified, skipped };
}

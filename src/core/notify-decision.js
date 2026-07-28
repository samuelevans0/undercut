// Pure. No I/O. Decides whether a deal is worth waking Samuel, and writes the
// copy that lands on the lock screen.

import { LIMITS } from "../config.js";

export function shouldNotify({
  score, threshold, forceNotify = false, notifiedAt = null,
  notifiedPriceCents = null, priceCents,
}) {
  if (notifiedAt) {
    // Already told him once. Only a materially cheaper price earns a second push.
    if (notifiedPriceCents && priceCents <= notifiedPriceCents * LIMITS.renotifyDropRatio) {
      return { notify: true, reason: "price-drop" };
    }
    return { notify: false, reason: "already-notified" };
  }
  if (forceNotify) return { notify: true, reason: "rule" };
  if (score >= threshold) return { notify: true, reason: "score" };
  return { notify: false, reason: "below-threshold" };
}

function money(cents) {
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

function ago(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "just now";
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function buildNotification({ deal, reference, sourceName, matches = [], nowSec = Math.floor(Date.now() / 1000) }) {
  const price = money(deal.price_cents);
  const conditionBits = deal.condition && deal.condition !== "new" ? ` (${deal.condition})` : "";
  const watch = matches.find((m) => m.type === "watchlist");
  const titleTail = watch ? ` [${watch.label}]` : "";
  const title = `${price} · ${deal.title}${conditionBits}${titleTail}`;

  const freshness = deal.posted_at ? ago(nowSec - deal.posted_at) : "just now";
  const tail = `Posted ${freshness} on ${sourceName}.`;

  let lead = null;
  if (reference?.floorCents && deal.price_cents < reference.floorCents) {
    lead = `Never seen below ${money(reference.floorCents)}.`;
  } else if (deal.was_price_cents && deal.was_price_cents > deal.price_cents) {
    const off = Math.round(((deal.was_price_cents - deal.price_cents) / deal.was_price_cents) * 100);
    lead = `${off}% off the usual ${money(deal.was_price_cents)}.`;
  }

  return { title, body: lead ? `${lead} ${tail}` : tail };
}

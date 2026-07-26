// Pure. No I/O. The whole judgement of the product lives here.

const OUTLIER_MAX = 50;
const OUTLIER_FULL_AT = 0.70;   // 70% below the learned floor earns full marks
const DISCOUNT_MAX = 25;
const DISCOUNT_FULL_AT = 0.60;  // 60% off the stated was-price earns full marks
const HEAT_MAX = 20;
const HEAT_FULL_AT = 2.0;       // twice the source baseline earns full marks

const CONDITION_PENALTY = 3;
const UNKNOWN_CATEGORY_PENALTY = 10;
const WEAK_SELLER_PENALTY = 5;
const WEAK_SELLER_BELOW = 95;

function linear(ratio, fullAt, max) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.min(max, Math.round((ratio / fullAt) * max));
}

function outlierPoints(priceCents, reference) {
  if (!reference?.floorCents || reference.floorCents <= 0) return { pts: 0, detail: "no reference price yet" };
  const under = (reference.floorCents - priceCents) / reference.floorCents;
  const pts = linear(under, OUTLIER_FULL_AT, OUTLIER_MAX);
  const detail = pts > 0
    ? `${(under * 100).toFixed(0)}% below the observed floor of $${(reference.floorCents / 100).toFixed(0)}`
    : `at or above the observed floor of $${(reference.floorCents / 100).toFixed(0)}`;
  return { pts, detail };
}

function discountPoints(priceCents, wasPriceCents) {
  if (!wasPriceCents || wasPriceCents <= priceCents) return { pts: 0, detail: "no stated discount" };
  const off = (wasPriceCents - priceCents) / wasPriceCents;
  return {
    pts: linear(off, DISCOUNT_FULL_AT, DISCOUNT_MAX),
    detail: `${(off * 100).toFixed(0)}% off the stated $${(wasPriceCents / 100).toFixed(0)}`,
  };
}

function heatPoints(heat) {
  if (!heat || !heat.baseline || heat.baseline <= 0) return { pts: 0, detail: "no activity data" };
  const ratio = heat.velocity / heat.baseline;
  return { pts: linear(ratio, HEAT_FULL_AT, HEAT_MAX), detail: `${ratio.toFixed(1)}x the usual activity` };
}

export function scoreDeal(input) {
  const {
    priceCents, wasPriceCents = null, category = "unknown", condition = "new",
    reference = null, heat = null, sellerRating = null, weights = {},
  } = input;

  const outlier = outlierPoints(priceCents, reference);
  const discount = discountPoints(priceCents, wasPriceCents);
  const activity = heatPoints(heat);

  const subtotal = outlier.pts + discount.pts + activity.pts;
  const weight = Number.isFinite(weights[category]) ? weights[category] : 1;
  const weighted = Math.round(subtotal * weight);

  let penalty = 0;
  const penaltyBits = [];
  if (condition !== "new") { penalty += CONDITION_PENALTY; penaltyBits.push(condition); }
  if (category === "unknown") { penalty += UNKNOWN_CATEGORY_PENALTY; penaltyBits.push("unrecognised item"); }
  if (sellerRating !== null && sellerRating < WEAK_SELLER_BELOW) {
    penalty += WEAK_SELLER_PENALTY;
    penaltyBits.push(`seller at ${sellerRating}%`);
  }

  const raw = weighted - penalty;
  const score = Math.max(0, Math.min(100, raw));

  const reasons = [
    { key: "outlier", label: "Outlier", points: outlier.pts, detail: outlier.detail },
    { key: "discount", label: "Discount", points: discount.pts, detail: discount.detail },
    { key: "heat", label: "Heat", points: activity.pts, detail: activity.detail },
    { key: "category", label: "Category", points: weighted - subtotal, detail: `${category} weighted ${weight}x` },
  ];
  if (penalty > 0) {
    reasons.push({ key: "penalty", label: "Penalty", points: -penalty, detail: penaltyBits.join(", ") });
  }

  return { score, subtotal, capped: raw > 100, reasons };
}

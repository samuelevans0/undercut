// Pure. No I/O. Extracts structured fields from a listing title.

const MERCHANTS = [
  "Amazon", "Newegg", "Best Buy", "B&H", "Micro Center", "Walmart", "Target",
  "Woot", "eBay", "Adorama", "Costco", "Dell", "Lenovo", "HP", "Monoprice", "Antonline",
];

// A price is a $ followed by digits, optional thousands groups, optional cents.
const PRICE_RE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

function toCents(raw) {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function detectCondition(title) {
  const t = title.toLowerCase();
  if (/\bopen[\s-]?box\b/.test(t)) return "openbox";
  if (/\brefurb(ished)?\b|\brenewed\b/.test(t)) return "refurb";
  if (/\bused\b|\bpre[\s-]?owned\b/.test(t)) return "used";
  return "new";
}

function detectMerchant(title) {
  for (const m of MERCHANTS) {
    const re = new RegExp(`\\b${m.replace(/[&]/g, "\\&")}\\b`, "i");
    if (re.test(title)) return m;
  }
  return null;
}

export function parseTitle(rawTitle) {
  const title = typeof rawTitle === "string" ? rawTitle : "";
  const empty = { cleanTitle: "", priceCents: null, wasPriceCents: null, merchant: null, condition: "new" };
  if (!title.trim()) return empty;

  const matches = [...title.matchAll(PRICE_RE)];
  const priceCents = matches.length ? toCents(matches[0][1]) : null;
  let wasPriceCents = matches.length > 1 ? toCents(matches[1][1]) : null;
  if (wasPriceCents !== null && priceCents !== null && wasPriceCents <= priceCents) wasPriceCents = null;

  // Clean: drop a leading [Tag], drop everything from the first price onward,
  // drop bracketed merchant tails, collapse separators.
  let clean = title.replace(/^\s*\[[^\]]*\]\s*/, "");
  if (matches.length) {
    const firstAt = clean.search(PRICE_RE_FRESH());
    if (firstAt > 0) clean = clean.slice(0, firstAt);
  }
  clean = clean.replace(/[\s\-–|,]+$/, "").replace(/\s{2,}/g, " ").trim();

  return {
    cleanTitle: clean,
    priceCents,
    wasPriceCents,
    merchant: detectMerchant(title),
    condition: detectCondition(title),
  };
}

// A fresh regex object each call: PRICE_RE is global and carries lastIndex state.
function PRICE_RE_FRESH() {
  return /\$\s?\d/;
}

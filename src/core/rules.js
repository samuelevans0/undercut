// Pure. No I/O. Watchlist and category rules force a notify independently of
// the score, so precision alerts survive any threshold setting.

const PRICE_PHRASE = /\b(?:under|below|less than|<)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/i;

const OPS = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  eq: (a, b) => a === b,
};

function haystack(deal) {
  return [deal.cleanTitle, deal.category, deal.specKey].filter(Boolean).join(" ").toLowerCase();
}

function matchesWatchlistEntry(deal, entry) {
  const raw = String(entry.query ?? "");
  const priceMatch = raw.match(PRICE_PHRASE);
  const ceilingFromQuery = priceMatch ? Math.round(parseFloat(priceMatch[1]) * 100) : null;
  const ceiling = entry.max_price_cents ?? ceilingFromQuery;

  const terms = raw
    .replace(PRICE_PHRASE, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return false;

  const hay = haystack(deal);
  if (!terms.every((t) => hay.includes(t))) return false;
  if (ceiling !== null && deal.priceCents > ceiling) return false;
  return true;
}

function fieldValue(deal, field) {
  if (field === "priceCents") return deal.priceCents;
  if (field === "category") return deal.category;
  if (field === "condition") return deal.condition;
  const specs = deal.specs ?? {};
  return Object.prototype.hasOwnProperty.call(specs, field) ? specs[field] : undefined;
}

function matchesRule(deal, rule) {
  if (rule.category !== "*" && rule.category !== deal.category) return false;
  let clauses;
  try {
    clauses = JSON.parse(rule.predicate_json);
  } catch {
    return false;
  }
  if (!Array.isArray(clauses) || !clauses.length) return false;
  return clauses.every((c) => {
    const op = OPS[c?.op];
    if (!op) return false;
    const value = fieldValue(deal, c.field);
    if (value === undefined || value === null) return false;
    return op(value, c.value);
  });
}

export function evaluateRules(deal, watchlist = [], rules = []) {
  const matches = [];
  for (const entry of watchlist) {
    if (matchesWatchlistEntry(deal, entry)) {
      matches.push({ type: "watchlist", id: entry.id, label: entry.label });
    }
  }
  for (const rule of rules) {
    if (matchesRule(deal, rule)) {
      matches.push({ type: "rule", id: rule.id, label: rule.label });
    }
  }
  return { forceNotify: matches.length > 0, matches };
}

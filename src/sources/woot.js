// Dumb adapter. Fetches and shapes. Never scores, classifies, or writes.
//
// Woot's public RSS feed (`/salerss`) is dead site-wide (404, discontinued
// long before this project started). This reads Woot's real developer API
// instead — https://developer.woot.com/feed/{feedname} — which needs a free
// API key requested via the Woot forums (not self-serve; issued weekly).
//
// The docs' own "example response" and its own formal `FeedPage` schema
// disagree on the top-level shape: the example shows `{Items:[...],
// MarketingName, TotalPages}`, the schema says a bare `[FeedItem]` array.
// Both are accepted defensively rather than guessing which is current.

const BASE = "https://developer.woot.com";

function dollars(range) {
  const n = range?.Minimum;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function toRawItem(offer) {
  const price = dollars(offer.SalePrice);
  const was = dollars(offer.ListPrice);
  // Fold price, was-price, and condition into the title so parse-title.js
  // stays the only module that understands prices (same convention as the
  // eBay adapter).
  const parts = [offer.Title ?? ""];
  if (offer.Condition && !/new/i.test(offer.Condition)) parts.push(`(${offer.Condition})`);
  if (price !== null) parts.push(`- $${price.toFixed(2).replace(/\.00$/, "")}`);
  if (was !== null && price !== null && was > price) parts.push(`($${was.toFixed(2).replace(/\.00$/, "")})`);

  const posted = Date.parse(offer.StartDate ?? "");

  return {
    externalId: offer.OfferId ?? offer.Url ?? "",
    rawTitle: parts.join(" "),
    url: offer.Url ?? "",
    tag: Array.isArray(offer.Categories) && offer.Categories.length ? offer.Categories[0] : null,
    postedAt: Number.isFinite(posted) ? Math.floor(posted / 1000) : null,
    upvotes: null,
    comments: null,
    sellerRating: null,
  };
}

function toFeedArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.Items)) return data.Items;
  return null;
}

export const wootAdapter = {
  id: "woot",
  async list(env, config = {}, fetchImpl = fetch) {
    if (!env.WOOT_API_KEY) throw new Error("woot credentials missing");

    const feeds = Array.isArray(config.feeds) && config.feeds.length ? config.feeds : ["Computers", "Electronics"];
    const out = [];
    for (const feedName of feeds) {
      const res = await fetchImpl(`${BASE}/feed/${encodeURIComponent(feedName)}`, {
        headers: { accept: "application/json", "x-api-key": env.WOOT_API_KEY },
      });
      if (!res.ok) throw new Error(`woot feed failed for ${feedName}: ${res.status}`);
      const data = await res.json();

      const items = toFeedArray(data);
      if (items === null) throw new Error(`woot feed for ${feedName} returned an unrecognised body`);

      for (const offer of items) {
        if (offer?.IsSoldOut) continue;
        out.push(toRawItem(offer));
      }
    }
    return out;
  },
};

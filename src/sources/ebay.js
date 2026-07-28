// Dumb adapter. Fetches and shapes. Never scores, classifies, or writes.

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

let cachedToken = null;

export function _resetTokenCache() {
  cachedToken = null;
}

async function getToken(env, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error("ebay credentials missing");

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
  });
  if (!res.ok) throw new Error(`ebay token request failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("ebay token missing from response");
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 7200) };
  return cachedToken.value;
}

function dollars(priceObj) {
  const n = parseFloat(priceObj?.value ?? "");
  return Number.isFinite(n) ? n : null;
}

function toRawItem(summary) {
  const price = dollars(summary.price);
  const was = dollars(summary.marketingPrice?.originalPrice);
  // Fold price, was-price, and condition into the title so parse-title.js stays
  // the only module that understands prices.
  const parts = [summary.title ?? ""];
  if (summary.condition && !/new/i.test(summary.condition)) parts.push(`(${summary.condition})`);
  if (price !== null) parts.push(`- $${price.toFixed(2).replace(/\.00$/, "")}`);
  if (was !== null && price !== null && was > price) parts.push(`($${was.toFixed(2).replace(/\.00$/, "")})`);

  const rating = parseFloat(summary.seller?.feedbackPercentage ?? "");
  const created = Date.parse(summary.itemCreationDate ?? "");

  return {
    externalId: summary.itemId ?? summary.itemWebUrl,
    rawTitle: parts.join(" "),
    url: summary.itemWebUrl ?? "",
    tag: null,
    postedAt: Number.isFinite(created) ? Math.floor(created / 1000) : null,
    upvotes: null,
    comments: null,
    sellerRating: Number.isFinite(rating) ? rating : null,
  };
}

export const ebayAdapter = {
  id: "ebay",
  async list(env, config = {}, fetchImpl = fetch) {
    const queries = Array.isArray(config.queries) ? config.queries.filter(Boolean) : [];
    if (!queries.length) return [];

    // isInteger and >= 0, not isFinite. A negative cursor gives a negative
    // modulo in JS (-1 % 3 is -1, not 2) and a fractional one misses every
    // array index, so `queries[cursor % len]` would be undefined and we would
    // spend one of the day's 288 searches looking up the literal word
    // "undefined" with nothing to show for it.
    const cursor = Number.isInteger(config.cursor) && config.cursor >= 0 ? config.cursor : 0;
    const query = queries[cursor % queries.length];

    const token = await getToken(env, fetchImpl);
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&limit=50&sort=newlyListed`;
    const res = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    if (!res.ok) throw new Error(`ebay search failed: ${res.status}`);
    const data = await res.json();

    // Third instance of the same hazard (see the Reddit and RSS adapters): a
    // 200 carrying something that is not a Browse API result body would read as
    // "no matches" rather than as a failure. eBay returns an error envelope
    // with 200 in some auth and quota cases.
    //
    // The legitimate empty here is `{"total": 0}` with no itemSummaries, which
    // is simply a search that matched nothing, and it stays allowed.
    if (typeof data?.total !== "number" && !Array.isArray(data?.itemSummaries)) {
      throw new Error(`ebay search returned an unrecognised body for "${query}"`);
    }

    return (data.itemSummaries ?? []).map(toRawItem);
  },
};

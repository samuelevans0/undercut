// Minimal RSS reader. Workers has no XML parser and runtime dependencies are
// forbidden, so this reads the four fields we need with regexes. RSS item
// bodies are simple enough that this is the right amount of machinery.

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'",
};

export function unescapeXml(s) {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
}

function tag(block, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  let value = m[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) return cdata[1].trim();
  return unescapeXml(value);
}

export function parseRss(xmlText) {
  if (typeof xmlText !== "string" || !xmlText.includes("<item")) return [];
  const out = [];
  for (const match of xmlText.matchAll(ITEM_RE)) {
    const block = match[1];
    out.push({
      title: tag(block, "title"),
      link: tag(block, "link"),
      pubDate: tag(block, "pubDate"),
      description: tag(block, "description"),
      guid: tag(block, "guid"),
    });
  }
  return out;
}

export function toUnixSeconds(pubDate) {
  const ms = Date.parse(pubDate ?? "");
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function rssItemToRaw(item) {
  return {
    externalId: item.guid || item.link || item.title,
    rawTitle: item.title ?? "",
    url: item.link ?? "",
    tag: null,
    postedAt: toUnixSeconds(item.pubDate),
    upvotes: null,
    comments: null,
    sellerRating: null,
  };
}

// Shared by every feed-based source adapter (RSS 2.0 and Atom alike): fetch,
// confirm it is actually feed-shaped, and hand back the raw text for the
// caller's own item/entry extraction. A 200 is not proof of a feed — Slickdeals,
// Woot, and Reddit all answer 200 with an HTML error or bot-challenge page when
// unhappy, and parsing that to zero items would look identical to a quiet feed.
//
// Note the deliberate asymmetry with callers: zero items/entries INSIDE a
// valid feed document is a legitimately quiet feed and stays allowed. Only a
// non-feed response is an error.
export async function fetchFeedText(url, fetchImpl, headers = {}) {
  const res = await fetchImpl(url, { headers: { "user-agent": "undercut/1.0 (private deal watcher)", ...headers } });
  if (!res.ok) throw new Error(`feed fetch failed for ${url}: ${res.status}`);
  const text = await res.text();
  if (!/<(rss|feed|channel)\b/i.test(text)) {
    const head = text.slice(0, 60).replace(/\s+/g, " ").trim();
    throw new Error(`feed at ${url} did not return RSS (got: ${head})`);
  }
  return text;
}

export async function fetchFeed(url, fetchImpl) {
  return parseRss(await fetchFeedText(url, fetchImpl));
}

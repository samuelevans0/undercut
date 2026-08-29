// Dumb adapter. Fetches and shapes. Never scores, classifies, or writes.
//
// Reddit closed self-serve OAuth app registration in November 2025 (replaced
// with a manual, ticketed approval process with no guaranteed turnaround).
// This adapter reads the public, unauthenticated RSS/Atom feed instead —
// `reddit.com/r/<sub>/new.rss` — which needs no credentials at all. A plain
// URL with no query string; adding `?limit=` was observed tripping Reddit's
// bot-detection into a 403 "Blocked" page during testing, so it is
// deliberately left off and the feed's default page size (25) is accepted.
//
// The trade-off: the JSON API's `ups`/`num_comments` fields have no Atom
// equivalent, so `upvotes`/`comments` are always null here. score.js already
// treats a missing heat signal as "no activity data" (0 points), so this
// degrades gracefully rather than breaking anything.

import { fetchFeedText, unescapeXml } from "./rss.js";

const ENTRY_RE = /<entry>([\s\S]*?)<\/entry>/g;
const LINK_RE = /<a\s+href="([^"]+)">\s*\[link\]\s*<\/a>/i;

function tag(block, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  return m ? unescapeXml(m[1].trim()) : null;
}

function selfLink(block) {
  const m = block.match(/<link\s+href="([^"]+)"\s*\/>/i);
  return m ? m[1] : null;
}

function titleTag(title) {
  const m = String(title ?? "").match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

function outboundUrl(contentHtml, fallback) {
  if (!contentHtml) return fallback;
  const m = contentHtml.match(LINK_RE);
  return m ? m[1] : fallback;
}

function toRawItem(block) {
  const title = tag(block, "title") ?? "";
  const rawContent = tag(block, "content");
  const link = selfLink(block);
  return {
    externalId: (tag(block, "id") ?? "").trim(),
    rawTitle: title,
    url: outboundUrl(rawContent, link ?? ""),
    tag: titleTag(title),
    postedAt: (() => {
      const ms = Date.parse(tag(block, "published") ?? "");
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    })(),
    upvotes: null,
    comments: null,
    sellerRating: null,
  };
}

export const redditAdapter = {
  id: "reddit",
  async list(env, config = {}, fetchImpl = fetch) {
    const subs = Array.isArray(config.subreddits) && config.subreddits.length
      ? config.subreddits
      : ["buildapcsales"];

    const items = [];
    for (const sub of subs) {
      const text = await fetchFeedText(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new.rss`, fetchImpl);
      for (const match of text.matchAll(ENTRY_RE)) {
        items.push(toRawItem(match[1]));
      }
    }
    return items;
  },
};

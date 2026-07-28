// Dumb adapter. Fetches and shapes. Never scores, classifies, or writes.

const UA = "web:undercut:1.0 (private deal watcher)";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

let cachedToken = null; // { value, expiresAt }

export function _resetTokenCache() {
  cachedToken = null;
}

async function getToken(env, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    throw new Error("reddit credentials missing");
  }
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`reddit token request failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("reddit token missing from response");
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return cachedToken.value;
}

function titleTag(title) {
  const m = String(title ?? "").match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

function toRawItem(post) {
  return {
    externalId: `t3_${post.id}`,
    rawTitle: post.title ?? "",
    url: post.url ?? `https://www.reddit.com${post.permalink ?? ""}`,
    tag: titleTag(post.title) ?? post.link_flair_text ?? null,
    postedAt: Number.isFinite(post.created_utc) ? Math.round(post.created_utc) : null,
    upvotes: Number.isFinite(post.ups) ? post.ups : null,
    comments: Number.isFinite(post.num_comments) ? post.num_comments : null,
    sellerRating: null,
  };
}

export const redditAdapter = {
  id: "reddit",
  async list(env, config = {}, fetchImpl = fetch) {
    const subs = Array.isArray(config.subreddits) && config.subreddits.length
      ? config.subreddits
      : ["buildapcsales"];
    const token = await getToken(env, fetchImpl);

    const items = [];
    for (const sub of subs) {
      const res = await fetchImpl(`https://oauth.reddit.com/r/${encodeURIComponent(sub)}/new?limit=50`, {
        headers: { authorization: `Bearer ${token}`, "user-agent": UA },
      });
      if (!res.ok) throw new Error(`reddit listing failed for ${sub}: ${res.status}`);
      const data = await res.json();

      // A 200 with no children array is NOT an empty day. Reddit answers 200
      // with `{"reason":"private"}` for private, quarantined and banned
      // subreddits, and `?? []` would turn that into a silent zero-result poll
      // that looks identical to nothing being posted. Throw so source health
      // records it and the source eventually disables itself loudly.
      const children = data?.data?.children;
      if (!Array.isArray(children)) {
        throw new Error(`reddit listing for ${sub} returned no children array (private, banned, or shape changed)`);
      }

      for (const child of children) {
        // Skip "more" stubs and anything that is not a link post.
        if (child?.kind === "t3" && child.data) items.push(toRawItem(child.data));
      }
    }
    return items;
  },
};

import { fetchFeed, rssItemToRaw } from "./rss.js";

const DEFAULT_FEED = "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1";

export const slickdealsAdapter = {
  id: "slickdeals",
  async list(env, config = {}, fetchImpl = fetch) {
    const url = config.feedUrl || DEFAULT_FEED;
    const items = await fetchFeed(url, fetchImpl);
    return items.map(rssItemToRaw);
  },
};

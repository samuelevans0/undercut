import { fetchFeed, rssItemToRaw } from "./rss.js";

export const wootAdapter = {
  id: "woot",
  async list(env, config = {}, fetchImpl = fetch) {
    const feeds = Array.isArray(config.feeds) && config.feeds.length ? config.feeds : ["computers"];
    const out = [];
    for (const feed of feeds) {
      const items = await fetchFeed(`https://${feed}.woot.com/salerss`, fetchImpl);
      out.push(...items.map(rssItemToRaw));
    }
    return out;
  },
};

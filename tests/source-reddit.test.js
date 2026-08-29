import { describe, it, expect, vi } from "vitest";
import { redditAdapter } from "../src/sources/reddit.js";
import atomXml from "./fixtures/reddit-buildapcsales.atom.xml?raw";

const okWith = (body) => vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/atom+xml" } }));

describe("redditAdapter", () => {
  it("returns one item per entry", async () => {
    const items = await redditAdapter.list({}, { subreddits: ["buildapcsales"] }, okWith(atomXml));
    expect(items).toHaveLength(4);
  });

  it("maps fields into the RawItem shape", async () => {
    const items = await redditAdapter.list({}, { subreddits: ["buildapcsales"] }, okWith(atomXml));
    const first = items[0];
    expect(first.externalId).toBe("t3_abc123");
    expect(first.rawTitle).toBe('[Monitor] LG 27GR83Q 27" 1440p 240Hz - $60 (Amazon)');
    expect(first.url).toBe("https://www.amazon.com/dp/B0EXAMPLE");
    expect(first.tag).toBe("Monitor");
    expect(first.postedAt).toBe(Math.floor(Date.parse("2026-01-15T12:00:00+00:00") / 1000));
    expect(first.upvotes).toBe(null);
    expect(first.comments).toBe(null);
    expect(first.sellerRating).toBe(null);
  });

  it("unescapes entities in the title", async () => {
    const items = await redditAdapter.list({}, { subreddits: ["buildapcsales"] }, okWith(atomXml));
    expect(items[1].rawTitle).toBe("[SSD] Samsung 1TB - $70 - Best Buy & Amazon");
    expect(items[1].tag).toBe("SSD");
    expect(items[1].url).toBe("https://www.bestbuy.com/site/example");
  });

  it("sets tag to null when the title has no bracket prefix", async () => {
    const items = await redditAdapter.list({}, { subreddits: ["buildapcsales"] }, okWith(atomXml));
    expect(items[2].tag).toBe(null);
    expect(items[2].rawTitle).toBe("Great deal on a mechanical keyboard - $40");
  });

  it("falls back to the entry's own reddit link when content has no outbound [link] anchor", async () => {
    const items = await redditAdapter.list({}, { subreddits: ["buildapcsales"] }, okWith(atomXml));
    const discussion = items[3];
    expect(discussion.externalId).toBe("t3_jkl000");
    expect(discussion.url).toBe("https://www.reddit.com/r/buildapcsales/comments/jkl000/discussion_thread/");
  });

  it("reads multiple subreddits", async () => {
    const f = okWith(atomXml);
    const items = await redditAdapter.list({}, { subreddits: ["a", "b"] }, f);
    expect(items).toHaveLength(8);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("defaults to buildapcsales with no config", async () => {
    const f = okWith(atomXml);
    await redditAdapter.list({}, {}, f);
    expect(f.mock.calls[0][0]).toContain("buildapcsales");
  });

  it("requests the RSS endpoint with no query params, and no credentials", async () => {
    const f = okWith(atomXml);
    await redditAdapter.list({ REDDIT_CLIENT_ID: undefined, REDDIT_CLIENT_SECRET: undefined }, { subreddits: ["x"] }, f);
    expect(f.mock.calls[0][0]).toBe("https://www.reddit.com/r/x/new.rss");
  });

  it("throws on a failed fetch", async () => {
    const f = vi.fn(async () => new Response("err", { status: 403 }));
    await expect(redditAdapter.list({}, { subreddits: ["a"] }, f)).rejects.toThrow(/403/);
  });

  it("throws when a 200 response is not a feed at all", async () => {
    const f = vi.fn(async () => new Response("<!doctype html><html><body>Blocked</body></html>", { status: 200 }));
    await expect(redditAdapter.list({}, { subreddits: ["a"] }, f)).rejects.toThrow(/did not return RSS/i);
  });

  it("allows a valid feed that genuinely has no entries", async () => {
    const quiet = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>quiet</title></feed>';
    const f = vi.fn(async () => new Response(quiet, { status: 200 }));
    await expect(redditAdapter.list({}, { subreddits: ["a"] }, f)).resolves.toEqual([]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { parseRss, fetchFeedText } from "../src/sources/rss.js";
import { slickdealsAdapter } from "../src/sources/slickdeals.js";
// The brief's fixture loader was `readFileSync(new URL(...), "utf8")`. That
// cannot work in this environment: @cloudflare/vitest-pool-workers runs every
// test file inside the workerd/Miniflare sandbox, whose virtualized node:fs
// has no real host disk access (confirmed in Task 3 with debug logging: a
// correctly formed file: URL to a file proven to exist still fails with
// "no such file or directory"). Same fix as tests/setup.js: Vite's `?raw`
// import suffix resolves file content at transform time instead of through
// runtime fs. Every it() block below is untouched.
import slickXml from "./fixtures/slickdeals.xml?raw";

const okWith = (body) => vi.fn(async () => new Response(body, { status: 200 }));

describe("parseRss", () => {
  it("reads every item", () => {
    expect(parseRss(slickXml)).toHaveLength(2);
  });

  it("unwraps CDATA", () => {
    expect(parseRss(slickXml)[0].title).toBe('LG 27GR83Q 27" 1440p 240Hz IPS Monitor - $60');
  });

  it("reads plain text titles", () => {
    expect(parseRss(slickXml)[1].title).toBe("Samsung 990 Pro 2TB NVMe SSD - $52 (was $169)");
  });

  it("unescapes entities", () => {
    expect(parseRss(slickXml)[1].description).toBe("Amazon & Newegg price match");
  });

  it("reads link, guid, and pubDate", () => {
    const item = parseRss(slickXml)[0];
    expect(item.link).toBe("https://slickdeals.net/f/12345-lg-monitor");
    expect(item.guid).toBe("https://slickdeals.net/f/12345-lg-monitor");
    expect(item.pubDate).toContain("04 Aug 2026");
  });

  it("returns an empty array for junk input", () => {
    expect(parseRss("not xml at all")).toEqual([]);
    expect(parseRss("")).toEqual([]);
    expect(parseRss(null)).toEqual([]);
  });

  it("ignores the channel title, which is not inside an item", () => {
    expect(parseRss(slickXml).some((i) => i.title === "Slickdeals Computer Deals")).toBe(false);
  });
});

describe("slickdealsAdapter", () => {
  it("maps items to the RawItem shape", async () => {
    const items = await slickdealsAdapter.list({}, {}, okWith(slickXml));
    expect(items).toHaveLength(2);
    expect(items[0].rawTitle).toContain("LG 27GR83Q");
    expect(items[0].url).toBe("https://slickdeals.net/f/12345-lg-monitor");
    expect(items[0].externalId).toBe("https://slickdeals.net/f/12345-lg-monitor");
    expect(items[0].tag).toBe(null);
    expect(items[0].upvotes).toBe(null);
    expect(typeof items[0].postedAt).toBe("number");
  });

  it("converts pubDate to unix seconds", async () => {
    const items = await slickdealsAdapter.list({}, {}, okWith(slickXml));
    expect(items[0].postedAt).toBe(Math.floor(Date.parse("Tue, 04 Aug 2026 02:14:00 -0400") / 1000));
  });

  it("throws on a failed fetch", async () => {
    const f = vi.fn(async () => new Response("err", { status: 503 }));
    await expect(slickdealsAdapter.list({}, {}, f)).rejects.toThrow(/503/);
  });

  it("throws when a 200 response is not a feed at all", async () => {
    // Bot challenge and error pages come back 200 with HTML. Parsing that to
    // zero items would look exactly like a quiet feed.
    const f = vi.fn(async () => new Response("<!doctype html><html><body>Access denied</body></html>", { status: 200 }));
    await expect(slickdealsAdapter.list({}, {}, f)).rejects.toThrow(/did not return RSS/i);
  });

  it("allows a valid feed that genuinely has no items", async () => {
    const quiet = '<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet</title></channel></rss>';
    const f = vi.fn(async () => new Response(quiet, { status: 200 }));
    await expect(slickdealsAdapter.list({}, {}, f)).resolves.toEqual([]);
  });
});

// wootAdapter now reads Woot's real developer API, not RSS. Its own coverage
// lives in tests/source-woot.test.js.

describe("fetchFeedText headers", () => {
  it("sends the default undercut user-agent with no override", async () => {
    const f = vi.fn(async () => new Response("<rss><channel></channel></rss>", { status: 200 }));
    await fetchFeedText("https://example.test/feed", f);
    expect(f.mock.calls[0][1].headers["user-agent"]).toMatch(/undercut/i);
  });

  it("lets a caller override headers, e.g. a browser-like user-agent", async () => {
    const f = vi.fn(async () => new Response("<rss><channel></channel></rss>", { status: 200 }));
    await fetchFeedText("https://example.test/feed", f, { "user-agent": "Mozilla/5.0 test" });
    expect(f.mock.calls[0][1].headers["user-agent"]).toBe("Mozilla/5.0 test");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { redditAdapter, _resetTokenCache } from "../src/sources/reddit.js";
import fixture from "./fixtures/reddit-buildapcsales.json";

const env = { REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret" };

// The token cache is module scope, so it survives between tests in this file.
// Without this, whichever test runs second sees a warm token and the
// "sends basic auth to the token endpoint" assertion finds no token call.
beforeEach(() => _resetTokenCache());

function fakeFetch(handlers) {
  return vi.fn(async (url, init) => {
    for (const [pattern, fn] of handlers) {
      if (String(url).includes(pattern)) return fn(url, init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const tokenOk = ["access_token", async () => Response.json({ access_token: "tok", expires_in: 3600 })];
const listingOk = ["oauth.reddit.com", async () => Response.json(fixture)];

describe("redditAdapter", () => {
  it("returns one item per post", async () => {
    const items = await redditAdapter.list(env, { subreddits: ["buildapcsales"] }, fakeFetch([tokenOk, listingOk]));
    expect(items).toHaveLength(3);
  });

  it("maps fields into the RawItem shape", async () => {
    const items = await redditAdapter.list(env, { subreddits: ["buildapcsales"] }, fakeFetch([tokenOk, listingOk]));
    const first = items[0];
    expect(first.externalId).toBe("t3_abc123");
    expect(first.rawTitle).toContain("LG 27GR83Q");
    expect(first.url).toBe("https://www.amazon.com/dp/B0EXAMPLE");
    expect(first.tag).toBe("Monitor");
    expect(first.postedAt).toBe(1800000000);
    expect(first.upvotes).toBe(340);
    expect(first.comments).toBe(41);
    expect(first.sellerRating).toBe(null);
  });

  it("prefers the title tag over the flair", async () => {
    const custom = structuredClone(fixture);
    custom.data.children[0].data.link_flair_text = "Wrong";
    const items = await redditAdapter.list(env, { subreddits: ["x"] }, fakeFetch([tokenOk, ["oauth", async () => Response.json(custom)]]));
    expect(items[0].tag).toBe("Monitor");
  });

  it("falls back to the flair when the title has no tag", async () => {
    const custom = structuredClone(fixture);
    custom.data.children[0].data.title = "LG monitor deal - $60";
    const items = await redditAdapter.list(env, { subreddits: ["x"] }, fakeFetch([tokenOk, ["oauth", async () => Response.json(custom)]]));
    expect(items[0].tag).toBe("Monitor");
  });

  it("sends basic auth to the token endpoint", async () => {
    const f = fakeFetch([tokenOk, listingOk]);
    await redditAdapter.list(env, { subreddits: ["x"] }, f);
    const tokenCall = f.mock.calls.find((c) => String(c[0]).includes("access_token"));
    expect(tokenCall[1].headers.authorization).toBe(`Basic ${btoa("id:secret")}`);
    expect(tokenCall[1].headers["user-agent"]).toMatch(/undercut/i);
  });

  it("reads multiple subreddits", async () => {
    const f = fakeFetch([tokenOk, listingOk]);
    const items = await redditAdapter.list(env, { subreddits: ["a", "b"] }, f);
    expect(items).toHaveLength(6);
    const listingCalls = f.mock.calls.filter((c) => String(c[0]).includes("oauth"));
    expect(listingCalls).toHaveLength(2);
  });

  it("reuses a cached token across calls", async () => {
    const f = fakeFetch([tokenOk, listingOk]);
    await redditAdapter.list(env, { subreddits: ["a"] }, f);
    await redditAdapter.list(env, { subreddits: ["a"] }, f);
    const tokenCalls = f.mock.calls.filter((c) => String(c[0]).includes("access_token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("throws when credentials are missing", async () => {
    await expect(redditAdapter.list({}, { subreddits: ["a"] }, fakeFetch([]))).rejects.toThrow(/credential/i);
  });

  it("throws when the token request fails", async () => {
    const f = fakeFetch([["access_token", async () => new Response("nope", { status: 401 })]]);
    await expect(redditAdapter.list(env, { subreddits: ["a"] }, f)).rejects.toThrow(/token/i);
  });

  it("throws when a listing request fails", async () => {
    const f = fakeFetch([tokenOk, ["oauth", async () => new Response("nope", { status: 429 })]]);
    await expect(redditAdapter.list(env, { subreddits: ["a"] }, f)).rejects.toThrow(/429/);
  });

  it("defaults to buildapcsales with no config", async () => {
    const f = fakeFetch([tokenOk, listingOk]);
    await redditAdapter.list(env, {}, f);
    expect(f.mock.calls.some((c) => String(c[0]).includes("buildapcsales"))).toBe(true);
  });
});

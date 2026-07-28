import { describe, it, expect, vi, beforeEach } from "vitest";
import { ebayAdapter, _resetTokenCache } from "../src/sources/ebay.js";
import { ADAPTERS, getAdapter } from "../src/sources/index.js";
import fixture from "./fixtures/ebay-search.json";

const env = { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" };

beforeEach(() => _resetTokenCache());

function fakeFetch(handlers) {
  return vi.fn(async (url, init) => {
    for (const [pattern, fn] of handlers) {
      if (String(url).includes(pattern)) return fn(url, init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const tokenOk = ["oauth2/token", async () => Response.json({ access_token: "tok", expires_in: 7200 })];
const searchOk = ["item_summary/search", async () => Response.json(fixture)];

describe("ebayAdapter", () => {
  it("maps summaries to the RawItem shape", async () => {
    const items = await ebayAdapter.list(env, { queries: ["240hz monitor"] }, fakeFetch([tokenOk, searchOk]));
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first.externalId).toBe("v1|123456789|0");
    expect(first.rawTitle).toContain("LG 27GR83Q");
    expect(first.rawTitle).toContain("$210");
    expect(first.url).toBe("https://www.ebay.com/itm/123456789");
    expect(first.sellerRating).toBe(99.2);
    expect(first.postedAt).toBe(Math.floor(Date.parse("2026-08-04T06:14:00.000Z") / 1000));
  });

  it("appends the original price so parse-title can read a was-price", async () => {
    const items = await ebayAdapter.list(env, { queries: ["x"] }, fakeFetch([tokenOk, searchOk]));
    expect(items[0].rawTitle).toContain("$599");
  });

  it("carries the condition through in the title text", async () => {
    const items = await ebayAdapter.list(env, { queries: ["x"] }, fakeFetch([tokenOk, searchOk]));
    expect(items[0].rawTitle).toMatch(/open box/i);
  });

  it("reads a weak seller rating", async () => {
    const items = await ebayAdapter.list(env, { queries: ["x"] }, fakeFetch([tokenOk, searchOk]));
    expect(items[1].sellerRating).toBe(88);
  });

  it("searches exactly one query per poll", async () => {
    const f = fakeFetch([tokenOk, searchOk]);
    await ebayAdapter.list(env, { queries: ["a", "b", "c"] }, f);
    const searches = f.mock.calls.filter((c) => String(c[0]).includes("item_summary/search"));
    expect(searches).toHaveLength(1);
  });

  it("rotates by cursor", async () => {
    const f = fakeFetch([tokenOk, searchOk]);
    await ebayAdapter.list(env, { queries: ["alpha", "beta"], cursor: 1 }, f);
    const search = f.mock.calls.find((c) => String(c[0]).includes("item_summary/search"));
    expect(String(search[0])).toContain("beta");
  });

  it("wraps the cursor past the end of the list", async () => {
    const f = fakeFetch([tokenOk, searchOk]);
    await ebayAdapter.list(env, { queries: ["alpha", "beta"], cursor: 5 }, f);
    const search = f.mock.calls.find((c) => String(c[0]).includes("item_summary/search"));
    expect(String(search[0])).toContain("beta");
  });

  it("returns nothing when there are no queries", async () => {
    const f = fakeFetch([tokenOk, searchOk]);
    expect(await ebayAdapter.list(env, { queries: [] }, f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("handles an empty result set", async () => {
    const f = fakeFetch([tokenOk, ["item_summary/search", async () => Response.json({ total: 0 })]]);
    expect(await ebayAdapter.list(env, { queries: ["x"] }, f)).toEqual([]);
  });

  it("throws on a 200 that is not a Browse API result body", async () => {
    // eBay returns an error envelope with 200 in some auth and quota cases.
    // Reading that as "no matches" would hide a broken source indefinitely.
    const f = fakeFetch([tokenOk, [
      "item_summary/search",
      async () => Response.json({ errors: [{ errorId: 1001, message: "quota exceeded" }] }),
    ]]);
    await expect(ebayAdapter.list(env, { queries: ["x"] }, f)).rejects.toThrow(/unrecognised body/i);
  });

  it("throws when credentials are missing", async () => {
    await expect(ebayAdapter.list({}, { queries: ["x"] }, fakeFetch([]))).rejects.toThrow(/credential/i);
  });

  it("throws on a failed search", async () => {
    const f = fakeFetch([tokenOk, ["item_summary/search", async () => new Response("no", { status: 500 })]]);
    await expect(ebayAdapter.list(env, { queries: ["x"] }, f)).rejects.toThrow(/500/);
  });
});

describe("adapter registry", () => {
  it("registers all four sources", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(["ebay", "reddit", "slickdeals", "woot"]);
  });

  it("looks an adapter up by id", () => {
    expect(getAdapter("woot").id).toBe("woot");
  });

  it("returns null for an unknown id", () => {
    expect(getAdapter("amazon")).toBe(null);
  });
});

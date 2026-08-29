import { describe, it, expect, vi } from "vitest";
import { wootAdapter } from "../src/sources/woot.js";
import fixture from "./fixtures/woot-computers.json";

const env = { WOOT_API_KEY: "test-woot-key" };

function fakeFetch(handlers) {
  return vi.fn(async (url, init) => {
    for (const [pattern, fn] of handlers) {
      if (String(url).includes(pattern)) return fn(url, init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const bareArray = ["Computers", async () => Response.json(fixture)];
const wrappedInItems = ["Computers", async () => Response.json({ Items: fixture, MarketingName: "Computers", TotalPages: 1 })];

describe("wootAdapter", () => {
  it("returns one item per in-stock offer, skipping sold-out ones", async () => {
    const items = await wootAdapter.list(env, { feeds: ["Computers"] }, fakeFetch([bareArray]));
    expect(items).toHaveLength(2);
    expect(items.every((i) => !i.rawTitle.includes("Sold Out"))).toBe(true);
  });

  it("maps fields into the RawItem shape, folding price into the title", async () => {
    const items = await wootAdapter.list(env, { feeds: ["Computers"] }, fakeFetch([bareArray]));
    const first = items[0];
    expect(first.externalId).toBe("2a3deba2-6f5a-43df-875a-ea84709c9a30");
    expect(first.rawTitle).toBe('LG 27GR83Q 27" 1440p 240Hz IPS Gaming Monitor - $59.99 ($399.99)');
    expect(first.url).toBe("https://computers.woot.com/offers/lg-27gr83q-monitor");
    expect(first.tag).toBe("Computers");
    expect(first.postedAt).toBe(Math.floor(Date.parse("2027-01-15T08:00:00.000Z") / 1000));
    expect(first.upvotes).toBe(null);
    expect(first.comments).toBe(null);
    expect(first.sellerRating).toBe(null);
  });

  it("marks refurbished condition in the folded title", async () => {
    const items = await wootAdapter.list(env, { feeds: ["Computers"] }, fakeFetch([bareArray]));
    expect(items[1].rawTitle).toContain("(Refurbished)");
  });

  it("also accepts the docs' alternate {Items:[...]} wrapped shape", async () => {
    const items = await wootAdapter.list(env, { feeds: ["Computers"] }, fakeFetch([wrappedInItems]));
    expect(items).toHaveLength(2);
  });

  it("fetches every configured feed", async () => {
    const f = fakeFetch([bareArray, ["Electronics", async () => Response.json(fixture)]]);
    const items = await wootAdapter.list(env, { feeds: ["Computers", "Electronics"] }, f);
    expect(items).toHaveLength(4);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("defaults to Computers and Electronics with no config", async () => {
    const f = fakeFetch([bareArray, ["Electronics", async () => Response.json(fixture)]]);
    await wootAdapter.list(env, {}, f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("sends the api key header", async () => {
    const f = fakeFetch([bareArray]);
    await wootAdapter.list(env, { feeds: ["Computers"] }, f);
    expect(f.mock.calls[0][1].headers["x-api-key"]).toBe("test-woot-key");
  });

  it("throws when the api key is missing", async () => {
    await expect(wootAdapter.list({}, { feeds: ["Computers"] }, fakeFetch([bareArray]))).rejects.toThrow(/credential/i);
  });

  it("throws when a feed request fails", async () => {
    const f = fakeFetch([["Computers", async () => new Response("nope", { status: 403 })]]);
    await expect(wootAdapter.list(env, { feeds: ["Computers"] }, f)).rejects.toThrow(/403/);
  });

  it("throws on a 200 that carries neither an array nor an Items array", async () => {
    const f = fakeFetch([["Computers", async () => Response.json({ error: "nope" })]]);
    await expect(wootAdapter.list(env, { feeds: ["Computers"] }, f)).rejects.toThrow(/unrecognised/i);
  });

  it("allows a feed that genuinely has no offers right now", async () => {
    const f = fakeFetch([["Computers", async () => Response.json([])]]);
    await expect(wootAdapter.list(env, { feeds: ["Computers"] }, f)).resolves.toEqual([]);
  });
});

import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/index.js";
import { pollSource } from "../src/poll.js";
import { signPollRequest } from "../src/lib/hmac-auth.js";
import { seedReferences } from "../src/db/refs.js";
import { addPushSub } from "../src/db/prefs.js";
import seedJson from "../seed/reference-prices.json";
import redditFixture from "./fixtures/reddit-buildapcsales.json";
import { _resetTokenCache } from "../src/sources/reddit.js";

const NOW = 1_800_000_000;

function fakeFetch() {
  return vi.fn(async (url) => {
    if (String(url).includes("access_token")) return Response.json({ access_token: "t", expires_in: 3600 });
    if (String(url).includes("oauth.reddit.com")) return Response.json(redditFixture);
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(async () => {
  _resetTokenCache();
  await env.DB.prepare("DELETE FROM notifications").run();
  await env.DB.prepare("DELETE FROM deal_events").run();
  await env.DB.prepare("DELETE FROM deals").run();
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
  await env.DB.prepare("DELETE FROM watchlist").run();
  await env.DB.prepare("DELETE FROM reference_prices").run();
  await env.DB.prepare("UPDATE sources SET last_polled_at = NULL, enabled = 1, consecutive_failures = 0, disabled_at = NULL").run();
  await env.DB.prepare("UPDATE prefs SET notify_threshold = 78 WHERE id = 1").run();
  await seedReferences(env.DB, seedJson, NOW);
});

describe("pollSource", () => {
  it("stores deals that have a parseable price", async () => {
    const r = await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    expect(r.status).toBe("ok");
    expect(r.seen).toBe(3);
    expect(r.stored).toBe(2);
    expect(r.skipped).toBe(1);
  });

  it("skips items with no price rather than storing junk", async () => {
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM deals WHERE title LIKE '%rules reminder%'").first();
    expect(row.n).toBe(0);
  });

  it("classifies and scores the monitor as an outlier", async () => {
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const row = await env.DB.prepare("SELECT * FROM deals WHERE category = 'monitor'").first();
    expect(row.spec_key).toBe("monitor:27:1440p:240hz");
    expect(row.price_cents).toBe(6000);
    expect(row.was_price_cents).toBe(39900);
    expect(row.score).toBeGreaterThanOrEqual(90);
  });

  it("appends a deal event per observation", async () => {
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM deal_events").first();
    expect(row.n).toBe(2);
  });

  it("pushes for the outlier and marks it notified", async () => {
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: true, gone: false }));
    const r = await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: send });
    expect(r.notified).toBeGreaterThanOrEqual(1);
    const row = await env.DB.prepare("SELECT * FROM deals WHERE category = 'monitor'").first();
    expect(row.notified_at).toBe(NOW);
  });

  it("does not notify the same deal twice across two polls", async () => {
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: true, gone: false }));
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: send });
    const firstCount = send.mock.calls.length;
    await pollSource(env, "reddit", NOW + 120, { fetchImpl: fakeFetch(), sendImpl: send });
    expect(send.mock.calls.length).toBe(firstCount);
  });

  it("updates in place rather than duplicating on a second poll", async () => {
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    await pollSource(env, "reddit", NOW + 120, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM deals").first();
    expect(row.n).toBe(2);
  });

  it("records a failure and never throws when the source errors", async () => {
    const boom = vi.fn(async () => { throw new Error("network down"); });
    const r = await pollSource(env, "reddit", NOW, { fetchImpl: boom, sendImpl: async () => ({ ok: true }) });
    expect(r.status).toBe("failed");
    const src = await env.DB.prepare("SELECT * FROM sources WHERE id = 'reddit'").first();
    expect(src.consecutive_failures).toBe(1);
  });

  it("auto-disables a source after three consecutive failures", async () => {
    const boom = vi.fn(async () => { throw new Error("down"); });
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare("UPDATE sources SET last_polled_at = NULL WHERE id = 'reddit'").run();
      await pollSource(env, "reddit", NOW + i, { fetchImpl: boom, sendImpl: async () => ({ ok: true }) });
    }
    const src = await env.DB.prepare("SELECT * FROM sources WHERE id = 'reddit'").first();
    expect(src.enabled).toBe(0);
  });

  it("clears the failure count after a success", async () => {
    const boom = vi.fn(async () => { throw new Error("down"); });
    await pollSource(env, "reddit", NOW, { fetchImpl: boom, sendImpl: async () => ({ ok: true }) });
    await env.DB.prepare("UPDATE sources SET last_polled_at = NULL WHERE id = 'reddit'").run();
    await pollSource(env, "reddit", NOW + 60, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const src = await env.DB.prepare("SELECT * FROM sources WHERE id = 'reddit'").first();
    expect(src.consecutive_failures).toBe(0);
  });

  it("reports not-due without fetching", async () => {
    const f = fakeFetch();
    await pollSource(env, "reddit", NOW, { fetchImpl: f, sendImpl: async () => ({ ok: true }) });
    const callsAfterFirst = f.mock.calls.length;
    const r = await pollSource(env, "reddit", NOW + 5, { fetchImpl: f, sendImpl: async () => ({ ok: true }) });
    expect(r.status).toBe("not-due");
    expect(f.mock.calls.length).toBe(callsAfterFirst);
  });

  it("returns unknown-source for an id with no adapter", async () => {
    const r = await pollSource(env, "amazon", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    expect(r.status).toBe("unknown-source");
  });

  it("fires a watchlist match below the score threshold", async () => {
    await env.DB.prepare("UPDATE prefs SET notify_threshold = 100 WHERE id = 1").run();
    await env.DB.prepare("INSERT INTO watchlist (label, query, created_at) VALUES ('ssd watch','990 pro',?)").bind(NOW).run();
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: true, gone: false }));
    const r = await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: send });
    expect(r.notified).toBe(1);
  });
});

describe("POST /api/poll/:source", () => {
  async function call(path, headers) {
    const req = new Request(`https://undercut.test${path}`, { method: "POST", headers });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("rejects an unsigned request", async () => {
    const res = await call("/api/poll/reddit", {});
    expect(res.status).toBe(401);
  });

  it("rejects a bad signature", async () => {
    const res = await call("/api/poll/reddit", { "x-uc-timestamp": String(NOW), "x-uc-signature": "deadbeef" });
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed request", async () => {
    const { timestamp, signature } = await signPollRequest(env.POLL_SECRET, "reddit");
    const res = await call("/api/poll/reddit", { "x-uc-timestamp": timestamp, "x-uc-signature": signature });
    expect([200, 204]).toContain(res.status);
  });

  it("404s an unknown source id", async () => {
    const { timestamp, signature } = await signPollRequest(env.POLL_SECRET, "amazon");
    const res = await call("/api/poll/amazon", { "x-uc-timestamp": timestamp, "x-uc-signature": signature });
    expect(res.status).toBe(404);
  });

  it("rejects GET", async () => {
    const { timestamp, signature } = await signPollRequest(env.POLL_SECRET, "reddit");
    const req = new Request("https://undercut.test/api/poll/reddit", {
      method: "GET", headers: { "x-uc-timestamp": timestamp, "x-uc-signature": signature },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(405);
  });
});

import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index.js";
import { upsertDeal, appendEvent, setScore } from "../src/db/deals.js";

const ORIGIN = "https://undercut.test";
const NOW = 1_800_000_000;
let cookie;

async function raw(path, { method = "GET", body, withCookie = true } = {}) {
  const headers = { "content-type": "application/json", origin: ORIGIN };
  if (withCookie && cookie) headers.cookie = cookie;
  const req = new Request(`${ORIGIN}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM deal_events").run();
  await env.DB.prepare("DELETE FROM deals").run();
  await env.DB.prepare("DELETE FROM watchlist").run();
  await env.DB.prepare("DELETE FROM rules").run();
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
  await env.DB.prepare("UPDATE prefs SET password_hash = NULL, setup_done = 0, notify_threshold = 78 WHERE id = 1").run();
  const res = await raw("/api/auth/setup", { method: "POST", body: { password: "a-long-enough-password" }, withCookie: false });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
});

async function seedDeal(over = {}) {
  const { id } = await upsertDeal(env.DB, {
    fingerprint: over.fingerprint ?? "fp1", sourceId: "reddit", title: 'LG 27" 240Hz',
    url: "https://x.test/1", priceCents: 6000, wasPriceCents: 39900,
    category: "monitor", specKey: "monitor:27:1440p:240hz", specs: { refreshHz: 240 },
    postedAt: NOW - 40, ...over,
  }, NOW);
  await setScore(env.DB, id, over.score ?? 99, [{ key: "outlier", label: "Outlier", points: 50, detail: "d" }]);
  return id;
}

describe("GET /api/feed", () => {
  it("requires a session", async () => {
    expect((await raw("/api/feed", { withCookie: false })).status).toBe(401);
  });

  it("returns deals newest first", async () => {
    await seedDeal({ fingerprint: "a" });
    await seedDeal({ fingerprint: "b" });
    const rows = await (await raw("/api/feed")).json();
    expect(rows.deals).toHaveLength(2);
  });

  it("filters by minScore", async () => {
    await seedDeal({ fingerprint: "a", score: 99 });
    await seedDeal({ fingerprint: "b", score: 10 });
    const rows = await (await raw("/api/feed?minScore=50")).json();
    expect(rows.deals).toHaveLength(1);
  });

  it("parses reasons into objects rather than returning raw json strings", async () => {
    await seedDeal();
    const rows = await (await raw("/api/feed")).json();
    expect(Array.isArray(rows.deals[0].reasons)).toBe(true);
    expect(rows.deals[0].reasons[0].key).toBe("outlier");
  });
});

describe("GET /api/deal/:id", () => {
  it("returns the deal, its reasons, and its price history", async () => {
    const id = await seedDeal();
    await appendEvent(env.DB, id, { priceCents: 7000 }, NOW - 600);
    await appendEvent(env.DB, id, { priceCents: 6000 }, NOW);
    const body = await (await raw(`/api/deal/${id}`)).json();
    expect(body.deal.price_cents).toBe(6000);
    expect(body.events).toHaveLength(2);
    expect(body.reasons[0].key).toBe("outlier");
  });

  it("includes the reference price when one exists", async () => {
    const id = await seedDeal();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO reference_prices (spec_key, category, typical_cents, floor_cents, origin, sample_count, updated_at) " +
      "VALUES ('monitor:27:1440p:240hz','monitor',32000,19800,'seed',0,?)"
    ).bind(NOW).run();
    const body = await (await raw(`/api/deal/${id}`)).json();
    expect(body.reference.floor_cents).toBe(19800);
  });

  it("404s an unknown id", async () => {
    expect((await raw("/api/deal/999999")).status).toBe(404);
  });
});

describe("settings", () => {
  it("returns prefs and source health", async () => {
    const body = await (await raw("/api/settings")).json();
    expect(body.prefs.notify_threshold).toBe(78);
    expect(body.sources).toHaveLength(4);
  });

  it("patches the threshold", async () => {
    await raw("/api/settings", { method: "PATCH", body: { notify_threshold: 85 } });
    const body = await (await raw("/api/settings")).json();
    expect(body.prefs.notify_threshold).toBe(85);
  });

  it("rejects an out of range threshold", async () => {
    expect((await raw("/api/settings", { method: "PATCH", body: { notify_threshold: 500 } })).status).toBe(400);
    expect((await raw("/api/settings", { method: "PATCH", body: { notify_threshold: -1 } })).status).toBe(400);
  });

  it("never exposes the password hash", async () => {
    const body = await (await raw("/api/settings")).json();
    expect(body.prefs.password_hash).toBeUndefined();
  });

  it("re-enables a disabled source", async () => {
    await env.DB.prepare("UPDATE sources SET enabled = 0, consecutive_failures = 3, disabled_at = ? WHERE id = 'woot'").bind(NOW).run();
    await raw("/api/sources/woot/enable", { method: "POST" });
    const row = await env.DB.prepare("SELECT * FROM sources WHERE id = 'woot'").first();
    expect(row.enabled).toBe(1);
    expect(row.consecutive_failures).toBe(0);
  });
});

describe("watchlist and rules", () => {
  it("adds, lists, and deletes a watchlist entry", async () => {
    const created = await (await raw("/api/watchlist", { method: "POST", body: { label: "240hz", query: "240hz monitor" } })).json();
    expect((await (await raw("/api/watchlist")).json()).watchlist).toHaveLength(1);
    await raw(`/api/watchlist/${created.id}`, { method: "DELETE" });
    expect((await (await raw("/api/watchlist")).json()).watchlist).toHaveLength(0);
  });

  it("rejects a watchlist entry with no query", async () => {
    expect((await raw("/api/watchlist", { method: "POST", body: { label: "x", query: "  " } })).status).toBe(400);
  });

  it("adds a rule and validates its predicate", async () => {
    const ok = await raw("/api/rules", {
      method: "POST",
      body: { label: "cheap nvme", category: "ssd", predicate: [{ field: "priceCents", op: "lt", value: 8000 }] },
    });
    expect(ok.status).toBe(200);
    const bad = await raw("/api/rules", {
      method: "POST",
      body: { label: "bad", category: "ssd", predicate: [{ field: "priceCents", op: "wat", value: 1 }] },
    });
    expect(bad.status).toBe(400);
  });

  it("rejects a predicate that is not an array", async () => {
    const res = await raw("/api/rules", { method: "POST", body: { label: "x", category: "ssd", predicate: "nope" } });
    expect(res.status).toBe(400);
  });
});

describe("push", () => {
  it("returns the vapid public key without a session", async () => {
    const res = await raw("/api/push/key", { withCookie: false });
    expect(res.status).toBe(401);
  });

  it("returns the vapid public key with a session", async () => {
    const body = await (await raw("/api/push/key")).json();
    expect(body.publicKey).toBe("test-vapid-public");
  });

  it("subscribes and unsubscribes", async () => {
    const sub = { endpoint: "https://push.test/x", keys: { p256dh: "k", auth: "a" } };
    expect((await raw("/api/push/subscribe", { method: "POST", body: sub })).status).toBe(200);
    let row = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first();
    expect(row.n).toBe(1);
    await raw("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
    row = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first();
    expect(row.n).toBe(0);
  });

  it("rejects a malformed subscription", async () => {
    expect((await raw("/api/push/subscribe", { method: "POST", body: { endpoint: "x" } })).status).toBe(400);
  });
});

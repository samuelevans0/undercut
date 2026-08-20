import { describe, it, expect, vi } from "vitest";
import pinger from "../cron-pinger/worker.js";
import { verifyPollRequest } from "../src/lib/hmac-auth.js";

const env = { UNDERCUT_ORIGIN: "https://undercut.pages.dev", POLL_SECRET: "test-poll-secret" };
const ctx = { waitUntil: (p) => p };

describe("cron pinger", () => {
  it("fans out one request per source", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await pinger.scheduled({}, env, ctx, f);
    expect(f).toHaveBeenCalledTimes(4);
    const paths = f.mock.calls.map((c) => new URL(c[0]).pathname).sort();
    expect(paths).toEqual(["/api/poll/ebay", "/api/poll/reddit", "/api/poll/slickdeals", "/api/poll/woot"]);
  });

  it("signs each request for its own source", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await pinger.scheduled({}, env, ctx, f);
    for (const [url, init] of f.mock.calls) {
      const sourceId = new URL(url).pathname.split("/").pop();
      const ok = await verifyPollRequest(
        env.POLL_SECRET, sourceId, init.headers["x-uc-timestamp"], init.headers["x-uc-signature"]
      );
      expect(ok).toBe(true);
    }
  });

  it("uses POST with no trailing slash", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await pinger.scheduled({}, env, ctx, f);
    for (const [url, init] of f.mock.calls) {
      expect(init.method).toBe("POST");
      expect(String(url).endsWith("/")).toBe(false);
    }
  });

  it("does not let one failing source stop the others", async () => {
    const f = vi.fn(async (url) => {
      if (String(url).includes("reddit")) throw new Error("down");
      return new Response(null, { status: 204 });
    });
    await expect(pinger.scheduled({}, env, ctx, f)).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("throws nothing when configuration is missing", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(pinger.scheduled({}, {}, ctx, f)).resolves.toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });
});

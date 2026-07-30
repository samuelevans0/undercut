import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index.js";

async function call(path, init) {
  const req = new Request(`https://undercut.test${path}`, init);
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("health", () => {
  it("answers /api/health", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("tolerates a trailing slash on api paths", async () => {
    const res = await call("/api/health/");
    expect(res.status).toBe(200);
  });

  it("401s unknown api routes as json when unauthenticated", async () => {
    // Task 15 added a global session gate in front of the routers: any path
    // outside OPEN_PREFIXES requires a session before routing decides
    // "not found", so an unauthenticated caller sees 401 rather than a 404
    // that would leak whether the route exists.
    const res = await call("/api/nope");
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });
});

import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index.js";

const ORIGIN = "https://undercut.test";

async function call(path, { method = "GET", body, cookie, origin = ORIGIN } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  const req = new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function cookieFrom(res) {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

beforeEach(async () => {
  await env.DB.prepare("UPDATE prefs SET password_hash = NULL, setup_done = 0 WHERE id = 1").run();
});

describe("first run setup", () => {
  it("reports that setup is needed", async () => {
    const res = await call("/api/auth/state");
    expect(await res.json()).toMatchObject({ setupDone: false, authenticated: false });
  });

  it("claims the instance and signs you in", async () => {
    const res = await call("/api/auth/setup", { method: "POST", body: { password: "a-long-enough-password" } });
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toMatch(/^uc_session=/);
  });

  it("refuses a short password", async () => {
    const res = await call("/api/auth/setup", { method: "POST", body: { password: "short" } });
    expect(res.status).toBe(400);
  });

  it("refuses a second setup once claimed", async () => {
    await call("/api/auth/setup", { method: "POST", body: { password: "a-long-enough-password" } });
    const res = await call("/api/auth/setup", { method: "POST", body: { password: "another-password-here" } });
    expect(res.status).toBe(409);
  });
});

describe("login", () => {
  beforeEach(async () => {
    await call("/api/auth/setup", { method: "POST", body: { password: "a-long-enough-password" } });
  });

  it("accepts the right password", async () => {
    const res = await call("/api/auth/login", { method: "POST", body: { password: "a-long-enough-password" } });
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toMatch(/^uc_session=/);
  });

  it("rejects the wrong password", async () => {
    const res = await call("/api/auth/login", { method: "POST", body: { password: "nope-nope-nope" } });
    expect(res.status).toBe(401);
  });

  it("reports an authenticated state with a valid cookie", async () => {
    const login = await call("/api/auth/login", { method: "POST", body: { password: "a-long-enough-password" } });
    const res = await call("/api/auth/state", { cookie: cookieFrom(login) });
    expect(await res.json()).toMatchObject({ setupDone: true, authenticated: true });
  });

  it("clears the cookie on logout", async () => {
    const login = await call("/api/auth/login", { method: "POST", body: { password: "a-long-enough-password" } });
    const res = await call("/api/auth/logout", { method: "POST", cookie: cookieFrom(login) });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("origin and session gating", () => {
  beforeEach(async () => {
    await call("/api/auth/setup", { method: "POST", body: { password: "a-long-enough-password" } });
  });

  it("rejects a cross-origin write", async () => {
    const res = await call("/api/auth/login", {
      method: "POST", body: { password: "a-long-enough-password" }, origin: "https://evil.test",
    });
    expect(res.status).toBe(403);
  });

  it("401s a gated route with no session", async () => {
    const res = await call("/api/feed");
    expect(res.status).toBe(401);
  });

  it("does not gate the poll endpoints behind a session", async () => {
    const res = await call("/api/poll/reddit", { method: "POST", origin: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("does not apply the origin check to poll endpoints", async () => {
    const res = await call("/api/poll/reddit", { method: "POST", origin: "https://evil.test" });
    expect(res.status).not.toBe(403);
  });
});

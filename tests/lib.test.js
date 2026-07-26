import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, hmacHex, timingSafeEqualStr } from "../src/lib/crypto.js";
import { createSessionCookie, readSession, clearSessionCookie } from "../src/lib/session.js";
import { signPollRequest, verifyPollRequest } from "../src/lib/hmac-auth.js";

function reqWithCookie(cookie) {
  return new Request("https://undercut.test/", { headers: { cookie } });
}

describe("crypto", () => {
  it("round-trips a password", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong horse", stored)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });

  it("rejects a malformed stored hash without throwing", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("compares strings without early exit", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
  });
});

describe("session", () => {
  const secret = "s3cret";

  it("round-trips a session cookie", async () => {
    const setCookie = await createSessionCookie("owner", secret);
    const value = setCookie.split(";")[0];
    expect(await readSession(reqWithCookie(value), secret)).toBe("owner");
  });

  it("rejects an expired cookie", async () => {
    const now = 1_800_000_000;
    const setCookie = await createSessionCookie("owner", secret, now);
    const value = setCookie.split(";")[0];
    const later = now + 91 * 24 * 3600;
    expect(await readSession(reqWithCookie(value), secret, later)).toBe(null);
  });

  it("rejects a tampered signature", async () => {
    const setCookie = await createSessionCookie("owner", secret);
    const value = setCookie.split(";")[0].slice(0, -1) + "0";
    expect(await readSession(reqWithCookie(value), secret)).toBe(null);
  });

  it("rejects a missing cookie", async () => {
    expect(await readSession(reqWithCookie(""), secret)).toBe(null);
  });

  it("clears with Max-Age=0", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});

describe("poll request signing", () => {
  const secret = "poll-secret";

  it("round-trips a signature", async () => {
    const { timestamp, signature } = await signPollRequest(secret, "reddit");
    expect(await verifyPollRequest(secret, "reddit", timestamp, signature)).toBe(true);
  });

  it("rejects a signature for a different source", async () => {
    const { timestamp, signature } = await signPollRequest(secret, "reddit");
    expect(await verifyPollRequest(secret, "woot", timestamp, signature)).toBe(false);
  });

  it("rejects a replay outside the window", async () => {
    const now = 1_800_000_000;
    const { timestamp, signature } = await signPollRequest(secret, "reddit", now);
    expect(await verifyPollRequest(secret, "reddit", timestamp, signature, now + 301)).toBe(false);
    expect(await verifyPollRequest(secret, "reddit", timestamp, signature, now + 299)).toBe(true);
  });

  it("rejects a non-numeric timestamp", async () => {
    const { signature } = await signPollRequest(secret, "reddit");
    expect(await verifyPollRequest(secret, "reddit", "abc", signature)).toBe(false);
  });
});

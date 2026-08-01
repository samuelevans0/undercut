import { describe, it, expect } from "vitest";
import { generateVapidKeys, vapidAuthHeader, encryptPushPayload } from "../src/lib/webpush.js";

describe("vapid", () => {
  it("generates a base64url public key of the right length", async () => {
    const { publicKey } = await generateVapidKeys();
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")).length).toBe(65);
  });

  it("builds an ES256 auth header for an endpoint", async () => {
    const { publicKey, privateJwk } = await generateVapidKeys();
    const header = await vapidAuthHeader("https://web.push.apple.com/abc", publicKey, privateJwk, "mailto:a@b.test");
    expect(header.startsWith("vapid t=")).toBe(true);
    expect(header).toContain(`k=${publicKey}`);
    const jwt = header.slice("vapid t=".length).split(",")[0];
    const claims = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims.aud).toBe("https://web.push.apple.com");
    expect(claims.sub).toBe("mailto:a@b.test");
  });

  it("produces an aes128gcm body with the RFC 8188 header layout", async () => {
    const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const p256dh = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const auth = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const body = await encryptPushPayload(new TextEncoder().encode('{"title":"x"}'), p256dh, auth);
    // 16 byte salt, 4 byte record size, 1 byte key length, 65 byte key, then ciphertext.
    expect(body.length).toBeGreaterThan(86);
    expect(body[20]).toBe(65);
  });
});

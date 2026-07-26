// Web Push without dependencies: VAPID (RFC 8292) + aes128gcm content
// encryption (RFC 8291 / RFC 8188) on WebCrypto. Payloads must stay well
// under 4KB; ours are ~200 bytes of JSON.

const enc = new TextEncoder();

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

// HKDF extract+expand, single block (all RFC 8291 outputs are <= 32 bytes).
async function hkdf(salt, ikm, info, len) {
  const prk = await hmac(salt, ikm);
  const t = await hmac(prk, concatBytes(info, new Uint8Array([1])));
  return t.slice(0, len);
}

export async function encryptPushPayload(payloadBytes, p256dh, auth) {
  const uaPublic = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);

  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256)
  );
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));

  const keyInfo = concatBytes(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concatBytes(payloadBytes, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const header = concatBytes(
    salt,
    new Uint8Array([0, 0, 16, 0]), // record size 4096, big-endian
    new Uint8Array([asPublic.length]),
    asPublic
  );
  return concatBytes(header, ciphertext);
}

export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: bytesToB64url(raw), privateJwk };
}

export async function vapidAuthHeader(endpoint, publicKeyB64url, privateJwkJson, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const jwk = typeof privateJwkJson === "string" ? JSON.parse(privateJwkJson) : privateJwkJson;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: nowSec + 12 * 3600, // Apple requires < 24h
    sub: subject,
  })));
  const signingInput = `${header}.${claims}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput))
  );
  return `vapid t=${signingInput}.${bytesToB64url(sig)}, k=${publicKeyB64url}`;
}

export async function sendPush(env, sub, payload, fetchImpl = fetch) {
  const body = await encryptPushPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const subject = env.VAPID_SUBJECT || "mailto:push@undercut.local";
  const authorization = await vapidAuthHeader(sub.endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, subject);
  let res;
  try {
    res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        authorization,
        "content-encoding": "aes128gcm",
        ttl: "86400",
        urgency: "high",
      },
      body,
    });
  } catch {
    return { ok: false, gone: false };
  }
  return { ok: res.ok, gone: res.status === 404 || res.status === 410 };
}

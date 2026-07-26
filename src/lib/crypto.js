const enc = new TextEncoder();

const PBKDF2_ITERATIONS = 100000;

function toBytes(data) {
  if (typeof data === "string") return enc.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = stored.split("$");
    if (scheme !== "pbkdf2") return false;
    const iterations = parseInt(iterStr, 10);
    if (!Number.isFinite(iterations) || iterations < 1) return false;
    const hash = await pbkdf2(password, b64ToBytes(saltB64), iterations);
    return timingSafeEqualStr(bytesToB64(hash), hashB64);
  } catch {
    return false;
  }
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

export async function sha256Hex(data) {
  const digest = await crypto.subtle.digest("SHA-256", toBytes(data));
  return bytesToHex(new Uint8Array(digest));
}

export function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function randomToken(bytes = 32) {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Canonical ingest signature shared by the relay template, the ingest
// endpoint, and tests: HMAC-SHA256(secret, "<ts>.<sha256hex(rawBody)>").
export async function signIngest(secret, ts, rawBody) {
  return hmacHex(secret, `${ts}.${await sha256Hex(rawBody)}`);
}

import { hmacHex, timingSafeEqualStr } from "./crypto.js";
import { LIMITS } from "../config.js";

const COOKIE = "uc_session";
const FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export async function createSessionCookie(userId, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = nowSec + LIMITS.sessionTtlSec;
  const sig = await hmacHex(secret, `${userId}.${exp}`);
  return `${COOKIE}=${userId}.${exp}.${sig}; Max-Age=${LIMITS.sessionTtlSec}; ${FLAGS}`;
}

export async function readSession(request, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const cookies = request.headers.get("cookie") || "";
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length !== 3) return null;
  const [uid, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!uid || !Number.isFinite(exp) || exp <= nowSec) return null;
  const expected = await hmacHex(secret, `${uid}.${exp}`);
  return timingSafeEqualStr(sig, expected) ? uid : null;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Max-Age=0; ${FLAGS}`;
}

import { hmacHex, timingSafeEqualStr } from "./crypto.js";
import { LIMITS } from "../config.js";

export async function signPollRequest(secret, sourceId, nowSec = Math.floor(Date.now() / 1000)) {
  const timestamp = String(nowSec);
  const signature = await hmacHex(secret, `${sourceId}.${timestamp}`);
  return { timestamp, signature };
}

export async function verifyPollRequest(
  secret,
  sourceId,
  timestamp,
  signature,
  nowSec = Math.floor(Date.now() / 1000)
) {
  if (!secret || !sourceId || !timestamp || !signature) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec - ts) > LIMITS.pollSignatureWindowSec) return false;
  const expected = await hmacHex(secret, `${sourceId}.${timestamp}`);
  return timingSafeEqualStr(signature, expected);
}

import { json, readJson, HttpError } from "../lib/http.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { createSessionCookie, readSession, clearSessionCookie } from "../lib/session.js";
import { getPrefs, setPrefs } from "../db/prefs.js";

const MIN_PASSWORD = 12;
const USER_ID = "owner";

export async function requireSession(request, env) {
  const uid = await readSession(request, env.SESSION_SECRET);
  if (!uid) throw new HttpError(401, "unauthorized");
  return uid;
}

export async function routeAuth(request, env, url, path) {
  if (path === "/api/auth/state" && request.method === "GET") {
    const prefs = await getPrefs(env.DB);
    const uid = await readSession(request, env.SESSION_SECRET);
    return json({ setupDone: prefs.setup_done === 1, authenticated: !!uid });
  }

  if (path === "/api/auth/setup" && request.method === "POST") {
    const prefs = await getPrefs(env.DB);
    if (prefs.setup_done === 1) return json({ error: "already claimed" }, 409);
    const { password } = await readJson(request);
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      return json({ error: `password must be at least ${MIN_PASSWORD} characters` }, 400);
    }
    await setPrefs(env.DB, { password_hash: await hashPassword(password), setup_done: 1 });
    const cookie = await createSessionCookie(USER_ID, env.SESSION_SECRET);
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  if (path === "/api/auth/login" && request.method === "POST") {
    const prefs = await getPrefs(env.DB);
    const { password } = await readJson(request);
    if (!prefs.password_hash || typeof password !== "string") {
      return json({ error: "invalid credentials" }, 401);
    }
    if (!(await verifyPassword(password, prefs.password_hash))) {
      return json({ error: "invalid credentials" }, 401);
    }
    const cookie = await createSessionCookie(USER_ID, env.SESSION_SECRET);
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  if (path === "/api/auth/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  return null;
}

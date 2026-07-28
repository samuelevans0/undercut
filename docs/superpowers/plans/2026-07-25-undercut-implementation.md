# Undercut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private single-user tech deal hunter that polls public deal feeds every minute, scores each deal against learned price history, and pushes Samuel's iPhone within ~60 seconds when something exceptional appears.

**Architecture:** A Cloudflare Pages app in advanced mode (`src/` bundled by esbuild to `public/_worker.js`) backed by D1, plus a ~40-line `undercut-pinger` Worker on a one-minute cron that fans out one HMAC-signed request per source so each feed parse gets its own CPU budget. Scoring lives in five pure, I/O-free modules that are unit-tested without network access.

**Tech Stack:** Cloudflare Pages + Workers + D1, vanilla ES modules (no framework), esbuild, vitest with `@cloudflare/vitest-pool-workers`, WebCrypto for auth and RFC 8291 web push.

**Spec:** `docs/superpowers/specs/2026-07-25-undercut-design.md`

## Global Constraints

- **Node/tooling versions match My Email exactly:** `wrangler ^4.107.0`, `vitest ^4.1.9`, `@cloudflare/vitest-pool-workers ^0.18.0`, `esbuild ^0.25.0`. `"type": "module"`.
- **Zero runtime dependencies.** No npm packages in `dependencies`. Everything uses WebCrypto and platform APIs. If a task seems to need a library, it does not.
- **All money is integer cents.** Never floats. Column names end in `_cents`.
- **All timestamps are integer Unix seconds.** Never ISO strings, never milliseconds, in the database.
- **Every pure core module is I/O-free.** No `fetch`, no `env`, no D1 access in `src/core/*`. They take data and return data. This is what makes them testable.
- **Every source adapter is dumb.** It fetches and shapes. It never scores, classifies, or writes to the database.
- **Push must never throw into the poll path.** Wrap it.
- **One failing source must never break a tick or affect another source.**
- **UI must not look AI-generated** (`ClaudeBrain/You/Preferences.md`). Direction is Ticker: monospace fixed-column rows, dark, score gutter on the left, colour functional only (green 90+, amber 78-89, dim below). No centred hero, no pill buttons, no generic three-column grids.
- **No em-dashes in user-facing copy.** Samuel treats them as an AI tell.
- **Never add AI co-author trailers to commits.**
- Commit messages use conventional prefixes (`feat:`, `test:`, `fix:`, `chore:`).
- **The verbatim test code in each task is authoritative, not the "Expected: PASS,
  N tests" line beneath it.** Those counts are the plan author's estimate and some
  are off by a few. Write the tests as given and report the real number. Never pad
  or trim tests to match a stated count.

## File Structure

```
Undercut/
├── package.json                    scripts + devDeps, zero runtime deps
├── wrangler.toml                   hybrid: main= for dev, [assets] for dev, Pages deploy separately
├── vitest.config.js                cloudflareTest plugin + miniflare test bindings
├── schema.sql                      full D1 schema, idempotent
├── seed/reference-prices.json      hand-built cold-start price table
├── scripts/generate-vapid.mjs      one-shot VAPID keypair generator
├── cron-pinger/
│   ├── worker.js                   fan-out scheduled() handler
│   └── wrangler.toml               crons = ["* * * * *"]
├── src/
│   ├── index.js                    router entry, trailing-slash tolerant
│   ├── config.js                   LIMITS, SOURCE_DEFAULTS, CATEGORY_WEIGHTS
│   ├── lib/
│   │   ├── http.js                 HttpError, json, readJson, checkOrigin   [vendored]
│   │   ├── crypto.js               hashPassword, verifyPassword, hmacHex     [vendored]
│   │   ├── session.js              cookie create/read/clear                  [vendored]
│   │   ├── webpush.js              sendPush, encryptPushPayload, VAPID       [vendored]
│   │   └── hmac-auth.js            poll endpoint request signing/verification
│   ├── core/                       PURE. no I/O. the five testable modules.
│   │   ├── parse-title.js          title -> {priceCents, wasPriceCents, merchant, condition}
│   │   ├── classify.js             title -> {category, specKey, specs}
│   │   ├── fingerprint.js          deal -> stable identity hash
│   │   ├── score.js                deal + refs + heat + weights -> {score, reasons, capped}
│   │   └── rules.js                deal + watchlist + rules -> {forceNotify, matchedLabel}
│   ├── sources/                    DUMB. fetch and shape only.
│   │   ├── index.js                registry: id -> adapter
│   │   ├── reddit.js               OAuth2 client_credentials + /new.json
│   │   ├── slickdeals.js           RSS
│   │   ├── woot.js                 RSS
│   │   ├── ebay.js                 Browse API + watchlist query rotation
│   │   └── rss.js                  shared minimal RSS parser
│   ├── db/
│   │   ├── deals.js                upsert, events, feed queries
│   │   ├── sources.js              health tracking, due checks
│   │   ├── refs.js                 reference price read + learn
│   │   └── prefs.js                prefs, watchlist, rules, push subs
│   ├── poll.js                     the pipeline: fetch -> store -> score -> notify
│   ├── notify.js                   notify decision + copy formatting + send
│   └── api/
│       ├── auth.js                 setup, login, logout
│       ├── feed.js                 feed list, deal detail
│       ├── settings.js             prefs, watchlist, rules, source health
│       └── push.js                 subscribe/unsubscribe
├── public/
│   ├── index.html                  app shell
│   ├── app.js                      screens + router
│   ├── app.css                     ticker design system
│   ├── sw.js                       service worker + push handler
│   ├── manifest.webmanifest
│   └── icons/                      192/512 maskable
└── tests/
    ├── fixtures/                   captured real feed responses
    └── *.test.js
```

**Why this shape.** `src/core/*` is the only place scoring logic lives and it never touches I/O, so the entire judgement of the product is testable with plain function calls. `src/sources/*` is the only place that knows about a specific website, so a feed changing its format is a one-file blast radius. `src/db/*` is the only place SQL lives.

---

### Task 1: Scaffold, config, and a green test run

**Files:**
- Create: `package.json`, `wrangler.toml`, `vitest.config.js`, `src/index.js`, `src/lib/http.js`, `src/config.js`, `public/index.html`, `docs/PROGRESS.md`
- Test: `tests/health.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `json(data, status?, headers?)`, `readJson(request, maxBytes?)`, `checkOrigin(request)`, `HttpError(status, message)` from `src/lib/http.js`. `LIMITS` from `src/config.js`. Default export `{ fetch(request, env, ctx) }` from `src/index.js`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "undercut",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "build:pages": "esbuild src/index.js --bundle --format=esm --outfile=public/_worker.js",
    "deploy:pages": "npm run build:pages && wrangler pages deploy public --project-name undercut --branch main --commit-dirty=true",
    "vapid": "node scripts/generate-vapid.mjs"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.18.0",
    "esbuild": "^0.25.0",
    "vitest": "^4.1.9",
    "wrangler": "^4.107.0"
  }
}
```

Run `npm install`.

- [ ] **Step 2: Create `wrangler.toml`**

This is the hybrid pattern from My Email: `main` + `[assets]` make `wrangler dev` and the vitest pool work as a Worker, while deploy goes out as Pages advanced mode via the bundled `public/_worker.js`. Leave `database_id` as the placeholder until Task 3 creates the real database.

```toml
name = "undercut"
main = "src/index.js"
compatibility_date = "2026-06-01"

[assets]
directory = "./public"
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "undercut-db"
database_id = "local"
```

- [ ] **Step 3: Create `vitest.config.js`**

```js
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          SESSION_SECRET: "test-session-secret",
          POLL_SECRET: "test-poll-secret",
          PUBLIC_ORIGIN: "https://undercut.test",
          VAPID_PUBLIC_KEY: "test-vapid-public",
          VAPID_PRIVATE_KEY: "{}",
          VAPID_SUBJECT: "mailto:push@undercut.test",
        },
      },
    }),
  ],
  test: {},
});
```

- [ ] **Step 4: Create `src/config.js`**

```js
export const LIMITS = {
  sessionTtlSec: 90 * 24 * 3600,
  pollSignatureWindowSec: 300,
  sourceFailureThreshold: 3,
  sourceRetryAfterSec: 3600,
  defaultNotifyThreshold: 78,
  renotifyDropRatio: 0.9,
  maxFeedRows: 200,
};

export const CATEGORY_WEIGHTS = {
  monitor: 1.2,
  gpu: 1.15,
  ssd: 1.1,
  cpu: 1.1,
  ram: 1.0,
  motherboard: 1.0,
  psu: 1.0,
  case: 0.9,
  cooler: 0.9,
  keyboard: 1.0,
  mouse: 1.0,
  headset: 1.0,
  audio: 1.0,
  webcam: 0.8,
  unknown: 0.5,
};
```

- [ ] **Step 5: Create `src/lib/http.js`**

Vendored verbatim from `My Email/src/lib/http.js`.

```js
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload too large");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid json");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "invalid json");
  }
  return data;
}

export function checkOrigin(request) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}
```

- [ ] **Step 6: Write the failing test**

`tests/health.test.js`:

```js
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

  it("404s unknown api routes as json", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty("error");
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/health.test.js`
Expected: FAIL, cannot resolve `../src/index.js`.

- [ ] **Step 8: Create `src/index.js`**

The trailing-slash normalisation is not optional. My Email lost real debugging time to a machine client posting to `/ingest/` and hitting the static asset fallback, which answers POST with a 405. See `ClaudeBrain/Knowledge/Cloudflare Pages exact-path routing and trailing slashes.md`.

```js
import { json, HttpError } from "./lib/http.js";

const routers = [];

async function handleApi(request, env, url, path) {
  if (path === "/api/health") return json({ ok: true });
  for (const route of routers) {
    const res = await route(request, env, url, path);
    if (res) return res;
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : url.pathname;
    try {
      if (path.startsWith("/api/")) return await handleApi(request, env, url, path);
      return env.ASSETS ? await env.ASSETS.fetch(request) : new Response("not found", { status: 404 });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error("unhandled error", e);
      return json({ error: "internal error" }, 500);
    }
  },
};
```

- [ ] **Step 9: Create `public/index.html` placeholder**

```html
<!doctype html>
<meta charset="utf-8">
<title>Undercut</title>
<p>Undercut</p>
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run tests/health.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 11: Create `docs/PROGRESS.md`**

Samuel's convention on long-running builds: the living build log is read first on resume and updated after every task.

```markdown
# Undercut build log

Spec: `docs/superpowers/specs/2026-07-25-undercut-design.md`
Plan: `docs/superpowers/plans/2026-07-25-undercut-implementation.md`

Read this file first when resuming. Update it at the end of every task.

## Status
Task 1 done: scaffold, config, health route, 3 tests green.

## Task ledger
- [x] T1 scaffold
- [ ] T2 vendored libs
- [ ] T3 schema + db layer
- [ ] T4 parse-title
- [ ] T5 classify
- [ ] T6 fingerprint
- [ ] T7 reference prices
- [ ] T8 score
- [ ] T9 rules
- [ ] T10 reddit source
- [ ] T11 rss sources (slickdeals, woot)
- [ ] T12 ebay source
- [ ] T13 notify
- [ ] T14 poll pipeline
- [ ] T15 auth api
- [ ] T16 read api
- [ ] T17 feed + detail UI
- [ ] T18 settings UI
- [ ] T19 PWA shell + push
- [ ] T20 cron-pinger
- [ ] T21 deploy runbook

## Gotchas found
(none yet)

## Assumptions to verify (from spec section 17)
- [ ] Per-source fan-out keeps each poll inside the free-tier CPU allowance
- [ ] Reddit requires OAuth from Cloudflare datacenter IPs
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: scaffold undercut pages app with health route"
```

---

### Task 2: Vendored crypto, session, and push libraries

**Files:**
- Create: `src/lib/crypto.js`, `src/lib/session.js`, `src/lib/webpush.js`, `src/lib/hmac-auth.js`
- Test: `tests/lib.test.js`

**Interfaces:**
- Consumes: `LIMITS` from `src/config.js`
- Produces:
  - `hashPassword(password) -> Promise<string>`, `verifyPassword(password, stored) -> Promise<boolean>`, `hmacHex(secret, message) -> Promise<string>`, `timingSafeEqualStr(a, b) -> boolean`
  - `createSessionCookie(userId, secret, nowSec?) -> Promise<string>`, `readSession(request, secret, nowSec?) -> Promise<string|null>`, `clearSessionCookie() -> string`
  - `sendPush(env, sub, payload, fetchImpl?) -> Promise<{ok: boolean, gone: boolean}>`, `generateVapidKeys() -> Promise<{publicKey, privateJwk}>`
  - `signPollRequest(secret, sourceId, nowSec?) -> Promise<{timestamp, signature}>`, `verifyPollRequest(secret, sourceId, timestamp, signature, nowSec?) -> Promise<boolean>`

- [ ] **Step 1: Copy `src/lib/crypto.js` from My Email verbatim**

Copy `F:\OneDrive\Schmamel's Stuff\Websites\My Email\src\lib\crypto.js` unchanged. It exports `hashPassword`, `verifyPassword`, `hmacHex`, and `timingSafeEqualStr`, all PBKDF2-SHA256 at 100000 iterations on WebCrypto. Do not rewrite it.

- [ ] **Step 2: Copy `src/lib/session.js` from My Email, changing only the cookie name**

Copy the file and change the cookie constant:

```js
const COOKIE = "uc_session";
```

Everything else, including the `Path=/; HttpOnly; Secure; SameSite=Lax` flags and the HMAC-signed `uid.exp.sig` format, stays as-is.

- [ ] **Step 3: Copy `src/lib/webpush.js` from My Email, changing only the subject fallback**

Copy the file. It exports `encryptPushPayload`, `generateVapidKeys`, `vapidAuthHeader`, and `sendPush`. Change one line inside `sendPush`, because `MAIL_DOMAIN` does not exist in this project:

```js
const subject = env.VAPID_SUBJECT || "mailto:push@undercut.local";
```

Do not touch the crypto. It is RFC 8291 `aes128gcm` and every WebCrypto-compatible npm alternative checked in 2026-07 uses the obsolete pre-2018 `aesgcm` encoding, which Apple's push service silently fails to decrypt. See `ClaudeBrain/Knowledge/Web push from Cloudflare Workers.md`.

- [ ] **Step 4: Write the failing test**

`tests/lib.test.js`:

```js
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
    const original = setCookie.split(";")[0];
    // Flip the last hex digit to something it definitely is not. Overwriting it
    // with a fixed character would leave the value unchanged whenever the
    // signature already ended in that character, which is a 1-in-16 false pass.
    const value = original.slice(0, -1) + (original.endsWith("0") ? "1" : "0");
    expect(value).not.toBe(original);
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/lib.test.js`
Expected: FAIL, cannot resolve `../src/lib/hmac-auth.js`.

- [ ] **Step 6: Create `src/lib/hmac-auth.js`**

```js
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
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/lib.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 8: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, 16 tests total.

- [ ] **Step 9: Update `docs/PROGRESS.md`** (tick T2, note the suite count) **and commit**

```bash
git add -A
git commit -m "feat: vendor crypto, session, and web push libs; add poll request signing"
```

---

### Task 3: D1 schema and the database layer

**Files:**
- Create: `schema.sql`, `src/db/sources.js`, `src/db/deals.js`, `src/db/prefs.js`
- Modify: `wrangler.toml` (real `database_id`), `vitest.config.js` (apply schema before tests)
- Test: `tests/db.test.js`

**Interfaces:**
- Consumes: `LIMITS` from `src/config.js`
- Produces:
  - `src/db/sources.js`: `listSources(db)`, `getSource(db, id)`, `isDue(source, nowSec)`, `markPolled(db, id, nowSec)`, `markFailure(db, id, nowSec)`, `markSuccess(db, id, nowSec)`
  - `src/db/deals.js`: `upsertDeal(db, deal, nowSec) -> {id, isNew, previousPriceCents}`, `appendEvent(db, dealId, {priceCents, upvotes, comments}, nowSec)`, `getDeal(db, id)`, `listFeed(db, {limit, minScore})`, `listEvents(db, dealId)`, `setScore(db, id, score, reasons)`, `markNotified(db, id, priceCents, nowSec)`
  - `src/db/prefs.js`: `getPrefs(db)`, `setPrefs(db, patch)`, `listWatchlist(db)`, `listRules(db)`, `listPushSubs(db)`, `addPushSub(db, sub, nowSec)`, `removePushSub(db, endpoint)`

- [ ] **Step 1: Create `schema.sql`**

```sql
-- Undercut D1 schema. Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS sources (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  config_json          TEXT NOT NULL DEFAULT '{}',
  poll_interval_s      INTEGER NOT NULL,
  last_polled_at       INTEGER,
  last_success_at      INTEGER,
  last_status          TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_at          INTEGER
);

CREATE TABLE IF NOT EXISTS deals (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint           TEXT NOT NULL UNIQUE,
  source_id             TEXT NOT NULL,
  external_id           TEXT,
  title                 TEXT NOT NULL,
  url                   TEXT NOT NULL,
  merchant              TEXT,
  condition             TEXT NOT NULL DEFAULT 'new',
  price_cents           INTEGER NOT NULL,
  was_price_cents       INTEGER,
  currency              TEXT NOT NULL DEFAULT 'USD',
  category              TEXT NOT NULL DEFAULT 'unknown',
  spec_key              TEXT,
  specs_json            TEXT NOT NULL DEFAULT '{}',
  posted_at             INTEGER,
  first_seen_at         INTEGER NOT NULL,
  last_seen_at          INTEGER NOT NULL,
  score                 INTEGER NOT NULL DEFAULT 0,
  score_reasons_json    TEXT NOT NULL DEFAULT '[]',
  notified_at           INTEGER,
  notified_price_cents  INTEGER,
  dead_at               INTEGER
);

CREATE INDEX IF NOT EXISTS idx_deals_seen  ON deals (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_score ON deals (score DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_spec  ON deals (spec_key);

CREATE TABLE IF NOT EXISTS deal_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  seen_at     INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  upvotes     INTEGER,
  comments    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_deal ON deal_events (deal_id, seen_at);

CREATE TABLE IF NOT EXISTS reference_prices (
  spec_key      TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  typical_cents INTEGER NOT NULL,
  floor_cents   INTEGER NOT NULL,
  origin        TEXT NOT NULL DEFAULT 'seed',
  sample_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  label           TEXT NOT NULL,
  query           TEXT NOT NULL,
  max_price_cents INTEGER,
  enabled         INTEGER NOT NULL DEFAULT 1,
  hit_count       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  label          TEXT NOT NULL,
  category       TEXT NOT NULL,
  predicate_json TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  hit_count      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prefs (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  notify_threshold INTEGER NOT NULL DEFAULT 78,
  weights_json     TEXT NOT NULL DEFAULT '{}',
  password_hash    TEXT,
  setup_done       INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO prefs (id) VALUES (1);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  failures   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id  INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  sent_at  INTEGER NOT NULL,
  result   TEXT NOT NULL
);

INSERT OR IGNORE INTO sources (id, name, poll_interval_s, config_json) VALUES
  ('reddit',     'Reddit',     60,  '{"subreddits":["buildapcsales"]}'),
  ('slickdeals', 'Slickdeals', 300, '{}'),
  ('woot',       'Woot',       900, '{}'),
  ('ebay',       'eBay',       300, '{}');
```

- [ ] **Step 2: Apply the schema to the local D1 database**

```bash
npx wrangler d1 execute undercut-db --local --file=./schema.sql
```

Local D1 is a SQLite file keyed by the binding, so this works against the
`database_id = "local"` placeholder without any Cloudflare account access.

**Do not run `wrangler d1 create` during the build.** Creating the real remote
database needs Cloudflare credentials and belongs to the deploy runbook in
Task 21, which replaces the placeholder id then. The test suite runs against
miniflare's own local D1 and never touches the remote one.

- [ ] **Step 3: Make the test pool apply the schema**

The pool's `applyD1Migrations` option expects a numbered migrations directory, which this project does not use. A setup file that runs `schema.sql` directly is the right fit. Create `tests/setup.js`:

```js
import { env } from "cloudflare:test";
import { beforeAll } from "vitest";
// Vite `?raw` import, NOT node:fs. `setupFiles` runs inside the workerd
// sandbox, which has no host disk access, so readFileSync cannot reach
// schema.sql however the path is spelled. Vite inlines this at build time.
import sql from "../schema.sql?raw";

beforeAll(async () => {
  for (const stmt of sql.split(";")) {
    const trimmed = stmt.trim();
    if (trimmed) await env.DB.prepare(trimmed).run();
  }
});
```

and register it in `vitest.config.js`:

```js
  test: { setupFiles: ["./tests/setup.js"] },
```

Remove the `applyD1Migrations` line you added a moment ago. It was a dead end and does not belong in the final config.

- [ ] **Step 4: Write the failing test**

`tests/db.test.js`:

```js
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { listSources, getSource, isDue, markPolled, markFailure, markSuccess } from "../src/db/sources.js";
import { upsertDeal, appendEvent, getDeal, listFeed, listEvents, setScore, markNotified } from "../src/db/deals.js";
import { getPrefs, setPrefs, listWatchlist, addPushSub, listPushSubs, removePushSub } from "../src/db/prefs.js";

const NOW = 1_800_000_000;

function sampleDeal(over = {}) {
  return {
    fingerprint: "fp-1",
    sourceId: "reddit",
    externalId: "t3_abc",
    title: 'LG 27GR83Q 27" 1440p 240Hz',
    url: "https://example.test/1",
    merchant: "Amazon",
    condition: "new",
    priceCents: 6000,
    wasPriceCents: 39900,
    currency: "USD",
    category: "monitor",
    specKey: "monitor:27:1440p:240hz",
    specs: { size: 27, refresh: 240 },
    postedAt: NOW - 40,
    ...over,
  };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM deal_events").run();
  await env.DB.prepare("DELETE FROM notifications").run();
  await env.DB.prepare("DELETE FROM deals").run();
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
});

describe("sources", () => {
  it("seeds all four sources", async () => {
    const rows = await listSources(env.DB);
    expect(rows.map((r) => r.id).sort()).toEqual(["ebay", "reddit", "slickdeals", "woot"]);
  });

  it("treats a never-polled source as due", () => {
    expect(isDue({ enabled: 1, poll_interval_s: 60, last_polled_at: null }, NOW)).toBe(true);
  });

  it("respects the poll interval", () => {
    const s = { enabled: 1, poll_interval_s: 300, last_polled_at: NOW - 100 };
    expect(isDue(s, NOW)).toBe(false);
    expect(isDue({ ...s, last_polled_at: NOW - 301 }, NOW)).toBe(true);
  });

  it("treats a disabled source as not due until the retry window elapses", () => {
    const s = { enabled: 0, poll_interval_s: 60, last_polled_at: NOW - 999, disabled_at: NOW - 10 };
    expect(isDue(s, NOW)).toBe(false);
    expect(isDue({ ...s, disabled_at: NOW - 3601 }, NOW)).toBe(true);
  });

  it("escalates failures and auto-disables at the threshold", async () => {
    for (let i = 0; i < 3; i++) await markFailure(env.DB, "woot", NOW);
    const s = await getSource(env.DB, "woot");
    expect(s.consecutive_failures).toBe(3);
    expect(s.enabled).toBe(0);
    expect(s.disabled_at).toBe(NOW);
  });

  it("pushes the retry window forward when an already-disabled source fails again", async () => {
    for (let i = 0; i < 3; i++) await markFailure(env.DB, "woot", NOW);
    await markFailure(env.DB, "woot", NOW + 3700);
    const s = await getSource(env.DB, "woot");
    expect(s.disabled_at).toBe(NOW + 3700);
    expect(isDue(s, NOW + 3800)).toBe(false);
  });

  it("clears failures and re-enables on success", async () => {
    for (let i = 0; i < 3; i++) await markFailure(env.DB, "woot", NOW);
    await markSuccess(env.DB, "woot", NOW + 10);
    const s = await getSource(env.DB, "woot");
    expect(s.consecutive_failures).toBe(0);
    expect(s.enabled).toBe(1);
    expect(s.disabled_at).toBe(null);
  });

  it("records the poll time", async () => {
    await markPolled(env.DB, "reddit", NOW);
    expect((await getSource(env.DB, "reddit")).last_polled_at).toBe(NOW);
  });
});

describe("deals", () => {
  it("inserts a new deal and reports it as new", async () => {
    const res = await upsertDeal(env.DB, sampleDeal(), NOW);
    expect(res.isNew).toBe(true);
    expect(res.previousPriceCents).toBe(null);
    const row = await getDeal(env.DB, res.id);
    expect(row.price_cents).toBe(6000);
    expect(row.first_seen_at).toBe(NOW);
  });

  it("updates in place on the same fingerprint and reports the old price", async () => {
    const first = await upsertDeal(env.DB, sampleDeal(), NOW);
    const second = await upsertDeal(env.DB, sampleDeal({ priceCents: 5000 }), NOW + 60);
    expect(second.id).toBe(first.id);
    expect(second.isNew).toBe(false);
    expect(second.previousPriceCents).toBe(6000);
    const row = await getDeal(env.DB, second.id);
    expect(row.price_cents).toBe(5000);
    expect(row.first_seen_at).toBe(NOW);
    expect(row.last_seen_at).toBe(NOW + 60);
  });

  it("appends events and reads them back in order", async () => {
    const { id } = await upsertDeal(env.DB, sampleDeal(), NOW);
    await appendEvent(env.DB, id, { priceCents: 6000, upvotes: 10, comments: 2 }, NOW);
    await appendEvent(env.DB, id, { priceCents: 5000, upvotes: 350, comments: 40 }, NOW + 240);
    const events = await listEvents(env.DB, id);
    expect(events).toHaveLength(2);
    expect(events[1].upvotes).toBe(350);
  });

  it("stores score and reasons", async () => {
    const { id } = await upsertDeal(env.DB, sampleDeal(), NOW);
    await setScore(env.DB, id, 99, [{ key: "outlier", points: 50 }]);
    const row = await getDeal(env.DB, id);
    expect(row.score).toBe(99);
    expect(JSON.parse(row.score_reasons_json)[0].key).toBe("outlier");
  });

  it("records the notified price", async () => {
    const { id } = await upsertDeal(env.DB, sampleDeal(), NOW);
    await markNotified(env.DB, id, 6000, NOW);
    const row = await getDeal(env.DB, id);
    expect(row.notified_at).toBe(NOW);
    expect(row.notified_price_cents).toBe(6000);
  });

  it("lists the feed newest first and honours minScore", async () => {
    const a = await upsertDeal(env.DB, sampleDeal({ fingerprint: "a" }), NOW);
    const b = await upsertDeal(env.DB, sampleDeal({ fingerprint: "b" }), NOW + 10);
    await setScore(env.DB, a.id, 90, []);
    await setScore(env.DB, b.id, 20, []);
    const all = await listFeed(env.DB, { limit: 10, minScore: 0 });
    expect(all[0].fingerprint).toBe("b");
    const good = await listFeed(env.DB, { limit: 10, minScore: 50 });
    expect(good.map((r) => r.fingerprint)).toEqual(["a"]);
  });
});

describe("prefs", () => {
  it("returns defaults", async () => {
    const p = await getPrefs(env.DB);
    expect(p.notify_threshold).toBe(78);
    expect(p.setup_done).toBe(0);
  });

  it("patches only the given fields", async () => {
    await setPrefs(env.DB, { notify_threshold: 85 });
    const p = await getPrefs(env.DB);
    expect(p.notify_threshold).toBe(85);
    expect(p.setup_done).toBe(0);
    await setPrefs(env.DB, { notify_threshold: 78 });
  });

  it("adds, lists, and removes push subscriptions", async () => {
    await addPushSub(env.DB, { endpoint: "https://push.test/1", p256dh: "k", auth: "a" }, NOW);
    expect(await listPushSubs(env.DB)).toHaveLength(1);
    await addPushSub(env.DB, { endpoint: "https://push.test/1", p256dh: "k2", auth: "a2" }, NOW);
    expect(await listPushSubs(env.DB)).toHaveLength(1);
    await removePushSub(env.DB, "https://push.test/1");
    expect(await listPushSubs(env.DB)).toHaveLength(0);
  });

  it("starts with an empty watchlist", async () => {
    expect(await listWatchlist(env.DB)).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/db.test.js`
Expected: FAIL, cannot resolve `../src/db/sources.js`.

- [ ] **Step 6: Create `src/db/sources.js`**

```js
import { LIMITS } from "../config.js";

export async function listSources(db) {
  const { results } = await db.prepare("SELECT * FROM sources ORDER BY id").all();
  return results ?? [];
}

export async function getSource(db, id) {
  return db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first();
}

export function isDue(source, nowSec) {
  if (!source) return false;
  if (!source.enabled) {
    if (!source.disabled_at) return false;
    return nowSec - source.disabled_at >= LIMITS.sourceRetryAfterSec;
  }
  if (!source.last_polled_at) return true;
  return nowSec - source.last_polled_at >= source.poll_interval_s;
}

export async function markPolled(db, id, nowSec) {
  await db.prepare("UPDATE sources SET last_polled_at = ? WHERE id = ?").bind(nowSec, id).run();
}

export async function markSuccess(db, id, nowSec) {
  await db
    .prepare(
      "UPDATE sources SET last_success_at = ?, last_status = 'ok', consecutive_failures = 0, " +
        "enabled = 1, disabled_at = NULL WHERE id = ?"
    )
    .bind(nowSec, id)
    .run();
}

export async function markFailure(db, id, nowSec, message = "error") {
  await db
    .prepare("UPDATE sources SET consecutive_failures = consecutive_failures + 1, last_status = ? WHERE id = ?")
    .bind(String(message).slice(0, 200), id)
    .run();
  // No `AND enabled = 1` guard here on purpose. An already-disabled source that
  // fails its hourly retry must push `disabled_at` forward, otherwise the retry
  // window stays permanently elapsed and a dead source gets polled every minute.
  await db
    .prepare("UPDATE sources SET enabled = 0, disabled_at = ? WHERE id = ? AND consecutive_failures >= ?")
    .bind(nowSec, id, LIMITS.sourceFailureThreshold)
    .run();
}
```

- [ ] **Step 7: Create `src/db/deals.js`**

`upsertDeal` reads the existing row first so it can report `previousPriceCents`, which the notify decision needs to detect a further price drop.

```js
import { LIMITS } from "../config.js";

export async function upsertDeal(db, deal, nowSec) {
  const existing = await db
    .prepare("SELECT id, price_cents FROM deals WHERE fingerprint = ?")
    .bind(deal.fingerprint)
    .first();

  if (existing) {
    await db
      .prepare(
        "UPDATE deals SET title = ?, url = ?, merchant = ?, condition = ?, price_cents = ?, " +
          "was_price_cents = ?, category = ?, spec_key = ?, specs_json = ?, last_seen_at = ? WHERE id = ?"
      )
      .bind(
        deal.title, deal.url, deal.merchant ?? null, deal.condition ?? "new", deal.priceCents,
        deal.wasPriceCents ?? null, deal.category ?? "unknown", deal.specKey ?? null,
        JSON.stringify(deal.specs ?? {}), nowSec, existing.id
      )
      .run();
    return { id: existing.id, isNew: false, previousPriceCents: existing.price_cents };
  }

  const res = await db
    .prepare(
      "INSERT INTO deals (fingerprint, source_id, external_id, title, url, merchant, condition, " +
        "price_cents, was_price_cents, currency, category, spec_key, specs_json, posted_at, " +
        "first_seen_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    .bind(
      deal.fingerprint, deal.sourceId, deal.externalId ?? null, deal.title, deal.url,
      deal.merchant ?? null, deal.condition ?? "new", deal.priceCents, deal.wasPriceCents ?? null,
      deal.currency ?? "USD", deal.category ?? "unknown", deal.specKey ?? null,
      JSON.stringify(deal.specs ?? {}), deal.postedAt ?? null, nowSec, nowSec
    )
    .run();
  return { id: res.meta.last_row_id, isNew: true, previousPriceCents: null };
}

export async function appendEvent(db, dealId, { priceCents, upvotes = null, comments = null }, nowSec) {
  await db
    .prepare("INSERT INTO deal_events (deal_id, seen_at, price_cents, upvotes, comments) VALUES (?,?,?,?,?)")
    .bind(dealId, nowSec, priceCents, upvotes, comments)
    .run();
}

export async function getDeal(db, id) {
  return db.prepare("SELECT * FROM deals WHERE id = ?").bind(id).first();
}

export async function listEvents(db, dealId) {
  const { results } = await db
    .prepare("SELECT * FROM deal_events WHERE deal_id = ? ORDER BY seen_at ASC")
    .bind(dealId)
    .all();
  return results ?? [];
}

export async function listFeed(db, { limit = 100, minScore = 0 } = {}) {
  const capped = Math.min(limit, LIMITS.maxFeedRows);
  const { results } = await db
    .prepare("SELECT * FROM deals WHERE score >= ? ORDER BY last_seen_at DESC LIMIT ?")
    .bind(minScore, capped)
    .all();
  return results ?? [];
}

export async function setScore(db, id, score, reasons) {
  await db
    .prepare("UPDATE deals SET score = ?, score_reasons_json = ? WHERE id = ?")
    .bind(score, JSON.stringify(reasons ?? []), id)
    .run();
}

export async function markNotified(db, id, priceCents, nowSec) {
  await db
    .prepare("UPDATE deals SET notified_at = ?, notified_price_cents = ? WHERE id = ?")
    .bind(nowSec, priceCents, id)
    .run();
}
```

- [ ] **Step 8: Create `src/db/prefs.js`**

`setPrefs` whitelists its columns. Never interpolate a caller-supplied key into SQL.

```js
const PREF_COLUMNS = ["notify_threshold", "weights_json", "password_hash", "setup_done"];

export async function getPrefs(db) {
  return db.prepare("SELECT * FROM prefs WHERE id = 1").first();
}

export async function setPrefs(db, patch) {
  const keys = Object.keys(patch).filter((k) => PREF_COLUMNS.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  await db
    .prepare(`UPDATE prefs SET ${sets} WHERE id = 1`)
    .bind(...keys.map((k) => patch[k]))
    .run();
}

export async function listWatchlist(db) {
  const { results } = await db
    .prepare("SELECT * FROM watchlist WHERE enabled = 1 ORDER BY created_at DESC")
    .all();
  return results ?? [];
}

export async function listRules(db) {
  const { results } = await db.prepare("SELECT * FROM rules WHERE enabled = 1 ORDER BY created_at DESC").all();
  return results ?? [];
}

export async function listPushSubs(db) {
  const { results } = await db.prepare("SELECT * FROM push_subscriptions").all();
  return results ?? [];
}

export async function addPushSub(db, sub, nowSec) {
  await db
    .prepare(
      "INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?,?,?,?) " +
        "ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, failures = 0"
    )
    .bind(sub.endpoint, sub.p256dh, sub.auth, nowSec)
    .run();
}

export async function removePushSub(db, endpoint) {
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/db.test.js`
Expected: PASS, 18 tests.

- [ ] **Step 10: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add d1 schema and database layer with source health tracking"
```

---

### Task 4: `parse-title.js`

**Files:**
- Create: `src/core/parse-title.js`
- Test: `tests/parse-title.test.js`

**Interfaces:**
- Consumes: nothing. Pure.
- Produces: `parseTitle(rawTitle) -> {cleanTitle, priceCents, wasPriceCents, merchant, condition}`. `priceCents` is `null` when no price is found. `condition` is one of `"new" | "refurb" | "used" | "openbox"`.

Prices are parsed to integer cents. `$1,299.99` becomes `129999`. r/buildapcsales titles carry a leading `[Category]` tag and frequently a trailing `- $279 ($399)` or `- $279 (was $399)`.

- [ ] **Step 1: Write the failing test**

`tests/parse-title.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parseTitle } from "../src/core/parse-title.js";

describe("parseTitle price extraction", () => {
  it("pulls a simple price", () => {
    expect(parseTitle("Some Monitor - $279").priceCents).toBe(27900);
  });

  it("handles thousands separators and decimals", () => {
    expect(parseTitle("GPU - $1,299.99").priceCents).toBe(129999);
  });

  it("handles a whole-dollar price with no decimals", () => {
    expect(parseTitle("Mouse - $18").priceCents).toBe(1800);
  });

  it("does not truncate a four-digit price written without a comma", () => {
    // A `\d{1,3}(?:,\d{3})*` leading branch matches just "160" here and never
    // backtracks, silently reading $1600 as $160. Most GPU prices look like this.
    expect(parseTitle("RTX 4090 - $1600").priceCents).toBe(160000);
    expect(parseTitle("Laptop - $1499.99").priceCents).toBe(149999);
    expect(parseTitle("Server - $12000").priceCents).toBe(1200000);
  });

  it("reads an uncomma'd was-price at full value too", () => {
    const r = parseTitle("GPU - $900 ($1600)");
    expect(r.priceCents).toBe(90000);
    expect(r.wasPriceCents).toBe(160000);
  });

  it("returns null when there is no price", () => {
    expect(parseTitle("[Monitor] Discussion thread").priceCents).toBe(null);
  });

  it("takes the first price as current and the second as was-price", () => {
    const r = parseTitle('LG 27" 1440p 240Hz - $279 ($399)');
    expect(r.priceCents).toBe(27900);
    expect(r.wasPriceCents).toBe(39900);
  });

  it("understands an explicit was-price", () => {
    const r = parseTitle("SSD - $52 (was $169)");
    expect(r.priceCents).toBe(5200);
    expect(r.wasPriceCents).toBe(16900);
  });

  it("ignores a was-price that is not higher than the price", () => {
    expect(parseTitle("Thing - $50 ($40)").wasPriceCents).toBe(null);
  });

  it("does not treat a resolution or refresh figure as a price", () => {
    const r = parseTitle('[Monitor] Samsung 32" 4K 144Hz 1000R - $399');
    expect(r.priceCents).toBe(39900);
    expect(r.wasPriceCents).toBe(null);
  });
});

describe("parseTitle condition", () => {
  it("detects refurbished", () => {
    expect(parseTitle("Logitech G Pro X (Refurbished) - $18").condition).toBe("refurb");
    expect(parseTitle("Dell monitor refurb - $80").condition).toBe("refurb");
  });

  it("detects open box", () => {
    expect(parseTitle("RTX 4070 Super Open Box - $210").condition).toBe("openbox");
    expect(parseTitle("RTX 4070 open-box - $210").condition).toBe("openbox");
  });

  it("detects used", () => {
    expect(parseTitle("Used ThinkPad dock - $25").condition).toBe("used");
  });

  it("defaults to new", () => {
    expect(parseTitle("Brand new SSD - $52").condition).toBe("new");
  });
});

describe("parseTitle merchant and cleaning", () => {
  it("extracts a known merchant name", () => {
    expect(parseTitle("[SSD] Samsung 990 Pro 2TB - $52 (Amazon)").merchant).toBe("Amazon");
    expect(parseTitle("Monitor - $279 [Best Buy]").merchant).toBe("Best Buy");
  });

  it("returns null for an unknown merchant", () => {
    expect(parseTitle("Monitor - $279").merchant).toBe(null);
  });

  it("strips the leading category tag and the price tail", () => {
    expect(parseTitle('[Monitor] LG 27GR83Q 27" 1440p 240Hz - $279 ($399)').cleanTitle)
      .toBe('LG 27GR83Q 27" 1440p 240Hz');
  });

  it("survives an empty or junk title", () => {
    expect(parseTitle("").priceCents).toBe(null);
    expect(parseTitle(null).cleanTitle).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/parse-title.test.js`
Expected: FAIL, cannot resolve `../src/core/parse-title.js`.

- [ ] **Step 3: Create `src/core/parse-title.js`**

```js
// Pure. No I/O. Extracts structured fields from a listing title.

const MERCHANTS = [
  "Amazon", "Newegg", "Best Buy", "B&H", "Micro Center", "Walmart", "Target",
  "Woot", "eBay", "Adorama", "Costco", "Dell", "Lenovo", "HP", "Monoprice", "Antonline",
];

// A price is a $ followed by digits, optional thousands groups, optional cents.
//
// Built fresh per call rather than shared: a /g regex object carries lastIndex,
// and a stray .test()/.exec() on a shared instance would silently make the next
// matchAll start mid-string and find nothing.
//
// One alternative only, and no {1,3} cap on the leading run. Writing this as
// `\d{1,3}(?:,\d{3})*|\d+` lets the first branch match just "160" of "$1600"
// with zero comma groups, and JS alternation never backtracks into the second
// branch once the first succeeds. That silently truncates every uncomma'd
// 4-digit price, which is most of the GPU and laptop range.
function priceRegex() {
  return /\$\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)/g;
}

function toCents(raw) {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function detectCondition(title) {
  const t = title.toLowerCase();
  if (/\bopen[\s-]?box\b/.test(t)) return "openbox";
  if (/\brefurb(ished)?\b|\brenewed\b/.test(t)) return "refurb";
  if (/\bused\b|\bpre[\s-]?owned\b/.test(t)) return "used";
  return "new";
}

function detectMerchant(title) {
  for (const m of MERCHANTS) {
    const re = new RegExp(`\\b${m.replace(/[&]/g, "\\&")}\\b`, "i");
    if (re.test(title)) return m;
  }
  return null;
}

export function parseTitle(rawTitle) {
  const title = typeof rawTitle === "string" ? rawTitle : "";
  const empty = { cleanTitle: "", priceCents: null, wasPriceCents: null, merchant: null, condition: "new" };
  if (!title.trim()) return empty;

  const matches = [...title.matchAll(priceRegex())];
  const priceCents = matches.length ? toCents(matches[0][1]) : null;
  let wasPriceCents = matches.length > 1 ? toCents(matches[1][1]) : null;
  if (wasPriceCents !== null && priceCents !== null && wasPriceCents <= priceCents) wasPriceCents = null;

  // Clean: drop a leading [Tag], then drop everything from the first price
  // onward (which also takes any trailing merchant tag with it), and tidy the
  // separator left dangling on the end.
  let clean = title.replace(/^\s*\[[^\]]*\]\s*/, "");
  if (matches.length) {
    const firstAt = clean.search(/\$\s?\d/);
    if (firstAt > 0) clean = clean.slice(0, firstAt);
  }
  clean = clean.replace(/[\s\-–|,]+$/, "").replace(/\s{2,}/g, " ").trim();

  return {
    cleanTitle: clean,
    priceCents,
    wasPriceCents,
    merchant: detectMerchant(title),
    condition: detectCondition(title),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/parse-title.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Update `docs/PROGRESS.md` and commit**

```bash
git add -A
git commit -m "feat: add pure title parser for price, was-price, merchant, condition"
```

---

### Task 5: `classify.js`

**Files:**
- Create: `src/core/classify.js`
- Test: `tests/classify.test.js`

**Interfaces:**
- Consumes: nothing. Pure.
- Produces: `classify(cleanTitle, hints?) -> {category, specKey, specs}`. `hints` is an optional `{tag}` carrying a source-supplied category label such as r/buildapcsales's `[Monitor]`. `category` is a key of `CATEGORY_WEIGHTS`, defaulting to `"unknown"`. `specKey` is a stable bucket string or `null`.

The spec key is what reference prices are keyed on, so it must be deterministic and coarse enough to accumulate samples. Monitors bucket as `monitor:<size>:<resolution>:<refresh>hz`, SSDs as `ssd:<interface>:<capacity>`, GPUs as `gpu:<model>`.

- [ ] **Step 1: Write the failing test**

`tests/classify.test.js`:

```js
import { describe, it, expect } from "vitest";
import { classify } from "../src/core/classify.js";

describe("classify category", () => {
  it("uses an explicit source tag when present", () => {
    expect(classify("LG 27GR83Q", { tag: "Monitor" }).category).toBe("monitor");
    expect(classify("Samsung 990 Pro", { tag: "SSD" }).category).toBe("ssd");
  });

  it("infers a monitor from specs in the title", () => {
    expect(classify('LG 27" 1440p 240Hz IPS').category).toBe("monitor");
  });

  it("infers an ssd", () => {
    expect(classify("Samsung 990 Pro 2TB NVMe M.2").category).toBe("ssd");
  });

  it("infers a gpu", () => {
    expect(classify("NVIDIA GeForce RTX 4070 Super 12GB").category).toBe("gpu");
    expect(classify("AMD Radeon RX 7800 XT").category).toBe("gpu");
  });

  it("infers a cpu", () => {
    expect(classify("AMD Ryzen 7 7800X3D").category).toBe("cpu");
    expect(classify("Intel Core i5-13600K").category).toBe("cpu");
  });

  it("infers peripherals", () => {
    expect(classify("Logitech G Pro X Superlight wireless mouse").category).toBe("mouse");
    expect(classify("Keychron Q1 mechanical keyboard").category).toBe("keyboard");
    expect(classify("SteelSeries Arctis Nova Pro headset").category).toBe("headset");
  });

  it("falls back to unknown", () => {
    expect(classify("Assorted mystery box").category).toBe("unknown");
  });

  it("recognises an Intel part with a suffix letter and no 'Core'", () => {
    // digit-to-letter is not a word boundary, so `i[3579]-\d{4,5}\b` never
    // matches "i5-13600K". Titles that omit "Core" hit only this branch.
    expect(classify("Intel i5-13600K Desktop Processor").category).toBe("cpu");
    expect(classify("Intel i7-12700KF").category).toBe("cpu");
    expect(classify("Intel i5-13600").category).toBe("cpu");
  });

  it("recognises a Radeon card written without the word Radeon", () => {
    expect(classify("XFX RX 7800 XT").category).toBe("gpu");
    expect(classify("Sapphire Pulse RX 7800 XT").specKey).toBe("gpu:rx7800xt");
  });

  it("does not file a motherboard as storage because it mentions M.2 and GB", () => {
    expect(classify("ASUS ROG Strix motherboard with M.2 slots, 32GB RAM kit").category)
      .toBe("motherboard");
  });

  it("prefers the tag over inference when they disagree", () => {
    expect(classify("RTX 4070 gaming monitor bundle", { tag: "Monitor" }).category).toBe("monitor");
  });
});

describe("classify spec keys", () => {
  it("buckets a monitor by size, resolution, and refresh", () => {
    const r = classify('LG 27GR83Q 27" 1440p 240Hz IPS', { tag: "Monitor" });
    expect(r.specKey).toBe("monitor:27:1440p:240hz");
    expect(r.specs).toMatchObject({ sizeInches: 27, resolution: "1440p", refreshHz: 240 });
  });

  it("normalises resolution synonyms", () => {
    expect(classify('Dell 32" 3840x2160 144Hz', { tag: "Monitor" }).specKey).toBe("monitor:32:4k:144hz");
    expect(classify('Acer 24" 1920x1080 165Hz', { tag: "Monitor" }).specKey).toBe("monitor:24:1080p:165hz");
    expect(classify('MSI 34" QHD 180Hz', { tag: "Monitor" }).specKey).toBe("monitor:34:1440p:180hz");
  });

  it("buckets an ssd by interface and capacity", () => {
    const r = classify("Samsung 990 Pro 2TB NVMe M.2", { tag: "SSD" });
    expect(r.specKey).toBe("ssd:nvme:2tb");
    expect(r.specs).toMatchObject({ capacityGb: 2048, interface: "nvme" });
  });

  it("treats sata separately from nvme", () => {
    expect(classify("Crucial MX500 1TB SATA SSD", { tag: "SSD" }).specKey).toBe("ssd:sata:1tb");
  });

  it("buckets a gpu by model", () => {
    expect(classify("MSI GeForce RTX 4070 Super Ventus 12GB").specKey).toBe("gpu:rtx4070super");
    expect(classify("Sapphire Radeon RX 7800 XT Pulse").specKey).toBe("gpu:rx7800xt");
  });

  it("returns a null spec key when specs are missing", () => {
    expect(classify("Some monitor", { tag: "Monitor" }).specKey).toBe(null);
  });

  it("returns a null spec key for unknown categories", () => {
    expect(classify("Assorted mystery box").specKey).toBe(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/classify.test.js`
Expected: FAIL, cannot resolve `../src/core/classify.js`.

- [ ] **Step 3: Create `src/core/classify.js`**

```js
// Pure. No I/O. Title -> category + reference-price bucket.

const TAG_MAP = {
  monitor: "monitor", display: "monitor",
  ssd: "ssd", hdd: "ssd", storage: "ssd",
  gpu: "gpu", "video card": "gpu",
  cpu: "cpu", motherboard: "motherboard", mobo: "motherboard",
  ram: "ram", memory: "ram", psu: "psu", case: "case", cooler: "cooler",
  keyboard: "keyboard", mouse: "mouse", headset: "headset", headphones: "audio",
  audio: "audio", speakers: "audio", webcam: "webcam", microphone: "audio",
};

const RESOLUTIONS = [
  [/\b(3840\s?x\s?2160|4k|uhd)\b/i, "4k"],
  [/\b(2560\s?x\s?1440|1440p|qhd|wqhd)\b/i, "1440p"],
  [/\b(3440\s?x\s?1440|uwqhd)\b/i, "1440p"],
  [/\b(1920\s?x\s?1080|1080p|fhd)\b/i, "1080p"],
];

function inferCategory(t) {
  // No trailing \b after the size unit. A `"` is a non-word character and so is
  // the space that follows it, so `\b` can never match there and `27" 1440p`
  // would fail to register as a monitor at all.
  if (/\b\d{2,3}\s?hz\b/i.test(t) && /\b\d{2}(?:"|\s?inch|-inch)/i.test(t)) return "monitor";

  // Motherboards and RAM are checked BEFORE storage on purpose. A board
  // advertising "M.2 slots" alongside a "32GB" figure satisfies both halves of
  // the SSD test and would otherwise be filed as a drive.
  if (/\bmotherboard\b|\bmobo\b/i.test(t)) return "motherboard";
  if (/\b(ddr[45])\b/i.test(t)) return "ram";

  if (/\b(nvme|m\.2|sata)\b/i.test(t) && /\b(ssd|\d+\s?(gb|tb))\b/i.test(t)) return "ssd";

  // Bare `rx` as well as `radeon rx`: plenty of titles read "XFX RX 7800 XT"
  // with no "Radeon" anywhere. The leading \b keeps "TRX40" out.
  if (/\b(rtx|gtx|radeon\s+rx|rx|arc\s+a)\s?\d{3,4}/i.test(t)) return "gpu";

  // `[a-z]{0,3}` before the boundary. Intel glues a suffix straight onto the
  // model number ("i5-13600K", "i7-12700KF"), and digit-to-letter is not a word
  // boundary, so `i[3579]-\d{4,5}\b` never matches a real Intel part. This was
  // masked by "Core i5" satisfying the middle alternative in tagged titles.
  if (/\b(?:ryzen|core\s+i[3579]|i[3579]-\d{4,5}[a-z]{0,3})\b/i.test(t)) return "cpu";

  if (/\bmouse\b|\bsuperlight\b/i.test(t)) return "mouse";
  if (/\bkeyboard\b|\bkeycaps?\b/i.test(t)) return "keyboard";
  if (/\bheadset\b/i.test(t)) return "headset";
  if (/\bheadphones?\b|\bearbuds?\b|\bspeakers?\b|\bdac\b/i.test(t)) return "audio";
  if (/\bwebcam\b/i.test(t)) return "webcam";
  if (/\bpsu\b|\bpower supply\b/i.test(t)) return "psu";
  if (/\b(aio|air cooler|cpu cooler)\b/i.test(t)) return "cooler";
  return "unknown";
}

function monitorSpecs(t) {
  const size = t.match(/\b(\d{2})\s?("|inch|-inch)/i);
  const refresh = t.match(/\b(\d{2,3})\s?hz\b/i);
  let resolution = null;
  for (const [re, name] of RESOLUTIONS) if (re.test(t)) { resolution = name; break; }
  const specs = {
    sizeInches: size ? parseInt(size[1], 10) : null,
    resolution,
    refreshHz: refresh ? parseInt(refresh[1], 10) : null,
  };
  const key = specs.sizeInches && specs.resolution && specs.refreshHz
    ? `monitor:${specs.sizeInches}:${specs.resolution}:${specs.refreshHz}hz`
    : null;
  return { specs, specKey: key };
}

function ssdSpecs(t) {
  const cap = t.match(/\b(\d+(?:\.\d+)?)\s?(tb|gb)\b/i);
  const iface = /\b(nvme|m\.2)\b/i.test(t) ? "nvme" : /\bsata\b/i.test(t) ? "sata" : null;
  let capacityGb = null;
  let label = null;
  if (cap) {
    const n = parseFloat(cap[1]);
    const isTb = cap[2].toLowerCase() === "tb";
    capacityGb = isTb ? Math.round(n * 1024) : Math.round(n);
    label = isTb ? `${n}tb` : `${n}gb`;
  }
  const specs = { capacityGb, interface: iface };
  return { specs, specKey: iface && label ? `ssd:${iface}:${label}` : null };
}

function gpuSpecs(t) {
  const m = t.match(/\b(rtx|gtx|rx|arc)\s?(\d{3,4})\s?(super|ti|xt|xtx)?\b/i);
  if (!m) return { specs: {}, specKey: null };
  const model = `${m[1]}${m[2]}${m[3] ?? ""}`.toLowerCase().replace(/\s+/g, "");
  return { specs: { model }, specKey: `gpu:${model}` };
}

export function classify(cleanTitle, hints = {}) {
  const t = typeof cleanTitle === "string" ? cleanTitle : "";
  const tag = hints.tag ? String(hints.tag).toLowerCase().trim() : null;
  const category = (tag && TAG_MAP[tag]) || inferCategory(t);

  let detail = { specs: {}, specKey: null };
  if (category === "monitor") detail = monitorSpecs(t);
  else if (category === "ssd") detail = ssdSpecs(t);
  else if (category === "gpu") detail = gpuSpecs(t);

  return { category, specKey: detail.specKey, specs: detail.specs };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/classify.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Update `docs/PROGRESS.md` and commit**

```bash
git add -A
git commit -m "feat: add pure classifier for category and reference price buckets"
```

---

### Task 6: `fingerprint.js`

**Files:**
- Create: `src/core/fingerprint.js`
- Test: `tests/fingerprint.test.js`

**Interfaces:**
- Consumes: nothing. Pure, but async because it uses WebCrypto SHA-256.
- Produces: `fingerprint({cleanTitle, merchant, category, specKey}) -> Promise<string>` returning a 32-char lowercase hex prefix.

Identity deliberately excludes price, so the same item reposted cheaper updates the existing row and stays eligible for a re-notify instead of arriving as a stranger.

- [ ] **Step 1: Write the failing test**

`tests/fingerprint.test.js`:

```js
import { describe, it, expect } from "vitest";
import { fingerprint } from "../src/core/fingerprint.js";

const base = {
  cleanTitle: 'LG 27GR83Q 27" 1440p 240Hz IPS',
  merchant: "Amazon",
  category: "monitor",
  specKey: "monitor:27:1440p:240hz",
};

describe("fingerprint", () => {
  it("is stable for identical input", async () => {
    expect(await fingerprint(base)).toBe(await fingerprint(base));
  });

  it("is 32 hex characters", async () => {
    expect(await fingerprint(base)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("ignores price entirely", async () => {
    const a = await fingerprint({ ...base, priceCents: 6000 });
    const b = await fingerprint({ ...base, priceCents: 5000 });
    expect(a).toBe(b);
  });

  it("ignores case, punctuation, and extra whitespace", async () => {
    const a = await fingerprint(base);
    const b = await fingerprint({ ...base, cleanTitle: 'lg  27gr83q -- 27" 1440p, 240hz  IPS!' });
    expect(a).toBe(b);
  });

  it("differs for a different merchant", async () => {
    expect(await fingerprint(base)).not.toBe(await fingerprint({ ...base, merchant: "Newegg" }));
  });

  it("differs for a different spec bucket", async () => {
    expect(await fingerprint(base)).not.toBe(
      await fingerprint({ ...base, specKey: "monitor:27:1440p:144hz" })
    );
  });

  it("treats a missing merchant as its own stable value", async () => {
    const a = await fingerprint({ ...base, merchant: null });
    const b = await fingerprint({ ...base, merchant: undefined });
    expect(a).toBe(b);
    expect(a).not.toBe(await fingerprint(base));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/fingerprint.test.js`
Expected: FAIL, cannot resolve `../src/core/fingerprint.js`.

- [ ] **Step 3: Create `src/core/fingerprint.js`**

```js
// Pure apart from WebCrypto hashing. Stable identity for a deal across sources.
// Price is deliberately excluded: a repost at a lower price must update the
// existing row, not create a second one.

const enc = new TextEncoder();

function normalise(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function fingerprint({ cleanTitle, merchant, category, specKey }) {
  const parts = [
    normalise(cleanTitle),
    normalise(merchant) || "nomerchant",
    normalise(category) || "unknown",
    normalise(specKey) || "nospec",
  ];
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(parts.join("|")));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/fingerprint.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add price-independent deal fingerprinting"
```

---

### Task 7: Reference prices, seeded and learned

**Files:**
- Create: `seed/reference-prices.json`, `src/core/reference.js`, `src/db/refs.js`
- Test: `tests/reference.test.js`

**Interfaces:**
- Consumes: nothing for `src/core/reference.js` (pure). `src/db/refs.js` takes a D1 handle.
- Produces:
  - `src/core/reference.js` (pure): `blendReference(seed, learned) -> {typicalCents, floorCents, origin, sampleCount}`, `learnFromPrices(pricesCents) -> {typicalCents, floorCents, sampleCount}`
  - `src/db/refs.js`: `getReference(db, specKey) -> Promise<row|null>`, `seedReferences(db, seedJson, nowSec)`, `updateLearned(db, specKey, category, pricesCents, seedJson, nowSec)`

`learnFromPrices` uses the median for typical and the 10th percentile for floor. Blending is `w = sampleCount < 5 ? 0 : min(1, sampleCount / 20)`, so seed values hold alone until five samples exist and hand over completely at twenty.

- [ ] **Step 1: Create `seed/reference-prices.json`**

Cold-start values. Keys must match exactly what `classify.js` produces. These are deliberately conservative: a floor that is too low only costs a missed alert, while a floor that is too high produces false 99s.

```json
{
  "monitor:24:1080p:144hz": { "category": "monitor", "typicalCents": 12000, "floorCents": 8000 },
  "monitor:24:1080p:165hz": { "category": "monitor", "typicalCents": 13000, "floorCents": 9000 },
  "monitor:27:1080p:144hz": { "category": "monitor", "typicalCents": 14000, "floorCents": 9500 },
  "monitor:27:1440p:144hz": { "category": "monitor", "typicalCents": 22000, "floorCents": 16000 },
  "monitor:27:1440p:165hz": { "category": "monitor", "typicalCents": 23000, "floorCents": 17000 },
  "monitor:27:1440p:180hz": { "category": "monitor", "typicalCents": 24000, "floorCents": 18000 },
  "monitor:27:1440p:240hz": { "category": "monitor", "typicalCents": 32000, "floorCents": 19800 },
  "monitor:27:4k:144hz":    { "category": "monitor", "typicalCents": 45000, "floorCents": 33000 },
  "monitor:32:1440p:165hz": { "category": "monitor", "typicalCents": 28000, "floorCents": 20000 },
  "monitor:32:4k:144hz":    { "category": "monitor", "typicalCents": 55000, "floorCents": 38000 },
  "monitor:34:1440p:180hz": { "category": "monitor", "typicalCents": 45000, "floorCents": 30000 },

  "ssd:nvme:1tb": { "category": "ssd", "typicalCents": 7000,  "floorCents": 4500 },
  "ssd:nvme:2tb": { "category": "ssd", "typicalCents": 13000, "floorCents": 8500 },
  "ssd:nvme:4tb": { "category": "ssd", "typicalCents": 26000, "floorCents": 18000 },
  "ssd:sata:1tb": { "category": "ssd", "typicalCents": 6000,  "floorCents": 4000 },
  "ssd:sata:2tb": { "category": "ssd", "typicalCents": 11000, "floorCents": 7500 },

  "gpu:rtx4060":      { "category": "gpu", "typicalCents": 29000, "floorCents": 24000 },
  "gpu:rtx4060ti":    { "category": "gpu", "typicalCents": 37000, "floorCents": 31000 },
  "gpu:rtx4070":      { "category": "gpu", "typicalCents": 52000, "floorCents": 44000 },
  "gpu:rtx4070super": { "category": "gpu", "typicalCents": 59000, "floorCents": 49000 },
  "gpu:rx7800xt":     { "category": "gpu", "typicalCents": 47000, "floorCents": 40000 }
}
```

- [ ] **Step 2: Write the failing test**

`tests/reference.test.js`:

```js
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { blendReference, learnFromPrices } from "../src/core/reference.js";
import { getReference, seedReferences, updateLearned } from "../src/db/refs.js";
import seedJson from "../seed/reference-prices.json";

const NOW = 1_800_000_000;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM reference_prices").run();
});

describe("learnFromPrices", () => {
  it("uses the median for typical", () => {
    expect(learnFromPrices([100, 200, 300]).typicalCents).toBe(200);
  });

  it("averages the two middle values for an even count", () => {
    expect(learnFromPrices([100, 200, 300, 400]).typicalCents).toBe(250);
  });

  it("uses the 10th percentile for the floor", () => {
    const prices = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    expect(learnFromPrices(prices).floorCents).toBe(110);
  });

  it("reports the sample count", () => {
    expect(learnFromPrices([1, 2, 3]).sampleCount).toBe(3);
  });

  it("handles a single sample", () => {
    const r = learnFromPrices([500]);
    expect(r.typicalCents).toBe(500);
    expect(r.floorCents).toBe(500);
  });

  it("returns nulls for no samples", () => {
    expect(learnFromPrices([])).toEqual({ typicalCents: null, floorCents: null, sampleCount: 0 });
  });
});

describe("blendReference", () => {
  const seed = { typicalCents: 32000, floorCents: 19800 };

  it("uses the seed alone below five samples", () => {
    const r = blendReference(seed, { typicalCents: 10000, floorCents: 5000, sampleCount: 4 });
    expect(r.typicalCents).toBe(32000);
    expect(r.origin).toBe("seed");
  });

  it("blends a quarter of the way at five samples", () => {
    const r = blendReference(seed, { typicalCents: 20000, floorCents: 12000, sampleCount: 5 });
    expect(r.typicalCents).toBe(29000);
    expect(r.origin).toBe("learned");
  });

  it("hands over completely at twenty samples", () => {
    const r = blendReference(seed, { typicalCents: 20000, floorCents: 12000, sampleCount: 20 });
    expect(r.typicalCents).toBe(20000);
    expect(r.floorCents).toBe(12000);
  });

  it("uses learned values alone when there is no seed", () => {
    const r = blendReference(null, { typicalCents: 20000, floorCents: 12000, sampleCount: 30 });
    expect(r.typicalCents).toBe(20000);
  });

  it("returns nulls when there is neither seed nor learned data", () => {
    const r = blendReference(null, { typicalCents: null, floorCents: null, sampleCount: 0 });
    expect(r.typicalCents).toBe(null);
    expect(r.floorCents).toBe(null);
  });

  it("ignores learned data below five samples even with no seed", () => {
    const r = blendReference(null, { typicalCents: 9999, floorCents: 9999, sampleCount: 2 });
    expect(r.typicalCents).toBe(null);
  });
});

describe("reference storage", () => {
  it("seeds every key from the json", async () => {
    await seedReferences(env.DB, seedJson, NOW);
    const row = await getReference(env.DB, "monitor:27:1440p:240hz");
    expect(row.floor_cents).toBe(19800);
    expect(row.origin).toBe("seed");
  });

  it("is idempotent", async () => {
    await seedReferences(env.DB, seedJson, NOW);
    await seedReferences(env.DB, seedJson, NOW);
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM reference_prices").all();
    expect(results[0].n).toBe(Object.keys(seedJson).length);
  });

  it("returns null for an unknown key", async () => {
    expect(await getReference(env.DB, "monitor:99:8k:999hz")).toBe(null);
  });

  it("writes blended values once enough samples exist", async () => {
    await seedReferences(env.DB, seedJson, NOW);
    const prices = Array(20).fill(20000);
    await updateLearned(env.DB, "monitor:27:1440p:240hz", "monitor", prices, seedJson, NOW);
    const row = await getReference(env.DB, "monitor:27:1440p:240hz");
    expect(row.typical_cents).toBe(20000);
    expect(row.origin).toBe("learned");
    expect(row.sample_count).toBe(20);
  });

  it("creates a row for a spec key that was never seeded", async () => {
    const prices = Array(20).fill(15000);
    await updateLearned(env.DB, "monitor:27:1440p:390hz", "monitor", prices, seedJson, NOW);
    const row = await getReference(env.DB, "monitor:27:1440p:390hz");
    expect(row.typical_cents).toBe(15000);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/reference.test.js`
Expected: FAIL, cannot resolve `../src/core/reference.js`.

- [ ] **Step 4: Create `src/core/reference.js`**

```js
// Pure. No I/O. Cold-start seed blended with learned observations.

const MIN_SAMPLES = 5;
const FULL_HANDOVER_SAMPLES = 20;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

export function learnFromPrices(pricesCents) {
  const list = (pricesCents ?? []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!list.length) return { typicalCents: null, floorCents: null, sampleCount: 0 };
  const mid = Math.floor(list.length / 2);
  const median = list.length % 2 === 0 ? Math.round((list[mid - 1] + list[mid]) / 2) : list[mid];
  return { typicalCents: median, floorCents: percentile(list, 0.1), sampleCount: list.length };
}

export function blendReference(seed, learned) {
  const n = learned?.sampleCount ?? 0;
  const hasLearned = n >= MIN_SAMPLES && learned.typicalCents !== null;
  if (!hasLearned) {
    if (!seed) return { typicalCents: null, floorCents: null, origin: "seed", sampleCount: n };
    return { typicalCents: seed.typicalCents, floorCents: seed.floorCents, origin: "seed", sampleCount: n };
  }
  if (!seed) {
    return { typicalCents: learned.typicalCents, floorCents: learned.floorCents, origin: "learned", sampleCount: n };
  }
  const w = Math.min(1, n / FULL_HANDOVER_SAMPLES);
  return {
    typicalCents: Math.round(seed.typicalCents * (1 - w) + learned.typicalCents * w),
    floorCents: Math.round(seed.floorCents * (1 - w) + learned.floorCents * w),
    origin: "learned",
    sampleCount: n,
  };
}
```

- [ ] **Step 5: Create `src/db/refs.js`**

```js
import { blendReference, learnFromPrices } from "../core/reference.js";

export async function getReference(db, specKey) {
  if (!specKey) return null;
  return db.prepare("SELECT * FROM reference_prices WHERE spec_key = ?").bind(specKey).first();
}

export async function seedReferences(db, seedJson, nowSec) {
  const stmt = db.prepare(
    "INSERT INTO reference_prices (spec_key, category, typical_cents, floor_cents, origin, sample_count, updated_at) " +
      "VALUES (?,?,?,?,'seed',0,?) ON CONFLICT(spec_key) DO NOTHING"
  );
  const batch = Object.entries(seedJson).map(([specKey, v]) =>
    stmt.bind(specKey, v.category, v.typicalCents, v.floorCents, nowSec)
  );
  // D1 caps bound parameters per call, so chunk. See the My Email cascade-delete fix.
  for (let i = 0; i < batch.length; i += 15) await db.batch(batch.slice(i, i + 15));
}

export async function updateLearned(db, specKey, category, pricesCents, seedJson, nowSec) {
  if (!specKey) return;
  const learned = learnFromPrices(pricesCents);
  const seed = seedJson?.[specKey] ?? null;
  const blended = blendReference(seed, learned);
  if (blended.typicalCents === null) return;
  await db
    .prepare(
      "INSERT INTO reference_prices (spec_key, category, typical_cents, floor_cents, origin, sample_count, updated_at) " +
        "VALUES (?,?,?,?,?,?,?) ON CONFLICT(spec_key) DO UPDATE SET " +
        "typical_cents = excluded.typical_cents, floor_cents = excluded.floor_cents, " +
        "origin = excluded.origin, sample_count = excluded.sample_count, updated_at = excluded.updated_at"
    )
    .bind(specKey, category, blended.typicalCents, blended.floorCents, blended.origin, blended.sampleCount, nowSec)
    .run();
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/reference.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 6: Update `docs/PROGRESS.md` and commit**

```bash
git add -A
git commit -m "feat: add seeded and learned reference prices with gradual handover"
```

---

### Task 8: `score.js`

**Files:**
- Create: `src/core/score.js`
- Test: `tests/score.test.js`

**Interfaces:**
- Consumes: `CATEGORY_WEIGHTS` from `src/config.js`
- Produces: `scoreDeal(input) -> {score, reasons, capped, subtotal}` where `input` is
  `{priceCents, wasPriceCents, category, condition, reference: {typicalCents, floorCents}|null, heat: {velocity, baseline}|null, sellerRating|null, weights}`.
  `reasons` is `[{key, label, points, detail}]`.

This is the module that decides whether Samuel's phone rings at 2am. Every branch gets a test.

Curves, all linear and clamped, matching spec section 8:

| Component | Full points at | Max |
|---|---|---|
| outlier | price 70% or more below the learned floor | 50 |
| discount | 60% or more off the stated was-price | 25 |
| heat | twice the source's baseline velocity | 20 |

Then `raw = round(subtotal * weight) - penalties`, clamped to 0..100. Penalties: refurb/used/openbox -3, unknown category -10, eBay seller rating below 95% -5.

- [ ] **Step 1: Write the failing test**

`tests/score.test.js`:

```js
import { describe, it, expect } from "vitest";
import { scoreDeal } from "../src/core/score.js";
import { CATEGORY_WEIGHTS } from "../src/config.js";

const W = CATEGORY_WEIGHTS;

function base(over = {}) {
  return {
    priceCents: 6000,
    wasPriceCents: 39900,
    category: "monitor",
    condition: "new",
    reference: { typicalCents: 32000, floorCents: 19800 },
    heat: { velocity: 2, baseline: 1 },
    sellerRating: null,
    weights: W,
    ...over,
  };
}

function points(result, key) {
  return result.reasons.find((r) => r.key === key)?.points ?? 0;
}

describe("scoreDeal, the headline case", () => {
  it("scores the $60 240Hz monitor at a capped 100", () => {
    const r = scoreDeal(base());
    expect(points(r, "outlier")).toBe(50);
    expect(points(r, "discount")).toBe(25);
    expect(points(r, "heat")).toBe(20);
    expect(r.subtotal).toBe(95);
    expect(points(r, "category")).toBe(19);
    expect(r.score).toBe(100);
    expect(r.capped).toBe(true);
  });
});

describe("outlier component", () => {
  it("gives zero at or above the floor", () => {
    expect(points(scoreDeal(base({ priceCents: 19800 })), "outlier")).toBe(0);
    expect(points(scoreDeal(base({ priceCents: 25000 })), "outlier")).toBe(0);
  });

  it("scales linearly below the floor", () => {
    // 35% below floor is half of the 70% needed for full marks.
    const r = scoreDeal(base({ priceCents: Math.round(19800 * 0.65), heat: null, wasPriceCents: null }));
    expect(points(r, "outlier")).toBe(25);
  });

  it("caps at 50", () => {
    expect(points(scoreDeal(base({ priceCents: 1 })), "outlier")).toBe(50);
  });

  it("gives zero with no reference data", () => {
    expect(points(scoreDeal(base({ reference: null })), "outlier")).toBe(0);
  });

  it("gives zero when the floor is zero or missing", () => {
    expect(points(scoreDeal(base({ reference: { typicalCents: 100, floorCents: 0 } })), "outlier")).toBe(0);
  });
});

describe("discount component", () => {
  it("gives zero without a was-price", () => {
    expect(points(scoreDeal(base({ wasPriceCents: null })), "discount")).toBe(0);
  });

  it("scales linearly", () => {
    // 30% off is half of the 60% needed for full marks.
    const r = scoreDeal(base({ priceCents: 7000, wasPriceCents: 10000 }));
    expect(points(r, "discount")).toBe(13);
  });

  it("caps at 25", () => {
    expect(points(scoreDeal(base({ priceCents: 100, wasPriceCents: 100000 })), "discount")).toBe(25);
  });

  it("gives zero when the was-price is not higher", () => {
    expect(points(scoreDeal(base({ priceCents: 5000, wasPriceCents: 5000 })), "discount")).toBe(0);
  });
});

describe("heat component", () => {
  it("gives zero with no heat data", () => {
    expect(points(scoreDeal(base({ heat: null })), "heat")).toBe(0);
  });

  it("gives half marks at baseline velocity", () => {
    expect(points(scoreDeal(base({ heat: { velocity: 1, baseline: 1 } })), "heat")).toBe(10);
  });

  it("caps at 20 above twice baseline", () => {
    expect(points(scoreDeal(base({ heat: { velocity: 99, baseline: 1 } })), "heat")).toBe(20);
  });

  it("gives zero when the baseline is zero", () => {
    expect(points(scoreDeal(base({ heat: { velocity: 5, baseline: 0 } })), "heat")).toBe(0);
  });
});

describe("weights and penalties", () => {
  it("applies the category weight as a delta reason", () => {
    const r = scoreDeal(base({ category: "ram", heat: null, wasPriceCents: null, priceCents: 19800 }));
    expect(r.subtotal).toBe(0);
    expect(points(r, "category")).toBe(0);
  });

  it("penalises refurbished", () => {
    const neu = scoreDeal(base({ priceCents: 15000 }));
    const ref = scoreDeal(base({ priceCents: 15000, condition: "refurb" }));
    expect(neu.score - ref.score).toBe(3);
  });

  it("penalises used and open box the same as refurbished", () => {
    const used = scoreDeal(base({ priceCents: 15000, condition: "used" }));
    const open = scoreDeal(base({ priceCents: 15000, condition: "openbox" }));
    expect(used.score).toBe(open.score);
  });

  it("penalises an unknown category by 10", () => {
    const r = scoreDeal(base({ category: "unknown", priceCents: 15000 }));
    expect(points(r, "penalty")).toBe(-10);
  });

  it("penalises a weak seller rating", () => {
    const good = scoreDeal(base({ priceCents: 15000, sellerRating: 99.5 }));
    const weak = scoreDeal(base({ priceCents: 15000, sellerRating: 90 }));
    expect(good.score - weak.score).toBe(5);
  });

  it("never returns a negative score", () => {
    const r = scoreDeal(base({
      priceCents: 32000, wasPriceCents: null, heat: null,
      category: "unknown", condition: "used", sellerRating: 50,
    }));
    expect(r.score).toBe(0);
  });

  it("marks capped only when the raw total exceeded 100", () => {
    expect(scoreDeal(base({ priceCents: 15000 })).capped).toBe(false);
  });
});

describe("a mediocre deal must not fire", () => {
  it("scores a 10% discount on a mid-price monitor well under the threshold", () => {
    const r = scoreDeal(base({
      priceCents: 29000, wasPriceCents: 32000,
      heat: { velocity: 0.2, baseline: 1 },
    }));
    expect(r.score).toBeLessThan(30);
  });
});

describe("cold start", () => {
  it("still scores usefully on a stated discount alone", () => {
    const r = scoreDeal(base({ reference: null, heat: null, priceCents: 10000, wasPriceCents: 40000 }));
    expect(points(r, "discount")).toBe(25);
    expect(r.score).toBe(30);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/score.test.js`
Expected: FAIL, cannot resolve `../src/core/score.js`.

- [ ] **Step 3: Create `src/core/score.js`**

```js
// Pure. No I/O. The whole judgement of the product lives here.

const OUTLIER_MAX = 50;
const OUTLIER_FULL_AT = 0.70;   // 70% below the learned floor earns full marks
const DISCOUNT_MAX = 25;
const DISCOUNT_FULL_AT = 0.60;  // 60% off the stated was-price earns full marks
const HEAT_MAX = 20;
const HEAT_FULL_AT = 2.0;       // twice the source baseline earns full marks

const CONDITION_PENALTY = 3;
const UNKNOWN_CATEGORY_PENALTY = 10;
const WEAK_SELLER_PENALTY = 5;
const WEAK_SELLER_BELOW = 95;

function linear(ratio, fullAt, max) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.min(max, Math.round((ratio / fullAt) * max));
}

function outlierPoints(priceCents, reference) {
  if (!reference?.floorCents || reference.floorCents <= 0) return { pts: 0, detail: "no reference price yet" };
  const under = (reference.floorCents - priceCents) / reference.floorCents;
  const pts = linear(under, OUTLIER_FULL_AT, OUTLIER_MAX);
  const detail = pts > 0
    ? `${(under * 100).toFixed(0)}% below the observed floor of $${(reference.floorCents / 100).toFixed(0)}`
    : `at or above the observed floor of $${(reference.floorCents / 100).toFixed(0)}`;
  return { pts, detail };
}

function discountPoints(priceCents, wasPriceCents) {
  if (!wasPriceCents || wasPriceCents <= priceCents) return { pts: 0, detail: "no stated discount" };
  const off = (wasPriceCents - priceCents) / wasPriceCents;
  return {
    pts: linear(off, DISCOUNT_FULL_AT, DISCOUNT_MAX),
    detail: `${(off * 100).toFixed(0)}% off the stated $${(wasPriceCents / 100).toFixed(0)}`,
  };
}

function heatPoints(heat) {
  if (!heat || !heat.baseline || heat.baseline <= 0) return { pts: 0, detail: "no activity data" };
  const ratio = heat.velocity / heat.baseline;
  return { pts: linear(ratio, HEAT_FULL_AT, HEAT_MAX), detail: `${ratio.toFixed(1)}x the usual activity` };
}

export function scoreDeal(input) {
  const {
    priceCents, wasPriceCents = null, category = "unknown", condition = "new",
    reference = null, heat = null, sellerRating = null, weights = {},
  } = input;

  const outlier = outlierPoints(priceCents, reference);
  const discount = discountPoints(priceCents, wasPriceCents);
  const activity = heatPoints(heat);

  const subtotal = outlier.pts + discount.pts + activity.pts;
  const weight = Number.isFinite(weights[category]) ? weights[category] : 1;
  const weighted = Math.round(subtotal * weight);

  let penalty = 0;
  const penaltyBits = [];
  if (condition !== "new") { penalty += CONDITION_PENALTY; penaltyBits.push(condition); }
  if (category === "unknown") { penalty += UNKNOWN_CATEGORY_PENALTY; penaltyBits.push("unrecognised item"); }
  if (sellerRating !== null && sellerRating < WEAK_SELLER_BELOW) {
    penalty += WEAK_SELLER_PENALTY;
    penaltyBits.push(`seller at ${sellerRating}%`);
  }

  const raw = weighted - penalty;
  const score = Math.max(0, Math.min(100, raw));

  const reasons = [
    { key: "outlier", label: "Outlier", points: outlier.pts, detail: outlier.detail },
    { key: "discount", label: "Discount", points: discount.pts, detail: discount.detail },
    { key: "heat", label: "Heat", points: activity.pts, detail: activity.detail },
    { key: "category", label: "Category", points: weighted - subtotal, detail: `${category} weighted ${weight}x` },
  ];
  if (penalty > 0) {
    reasons.push({ key: "penalty", label: "Penalty", points: -penalty, detail: penaltyBits.join(", ") });
  }

  return { score, subtotal, capped: raw > 100, reasons };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/score.test.js`
Expected: PASS, 22 tests.

- [ ] **Step 5: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add pure scoring engine with outlier, discount, and heat components"
```

---

### Task 9: `rules.js`

**Files:**
- Create: `src/core/rules.js`
- Test: `tests/rules.test.js`

**Interfaces:**
- Consumes: nothing. Pure.
- Produces: `evaluateRules(deal, watchlist, rules) -> {forceNotify, matches}` where `matches` is `[{type, id, label}]`, `type` being `"watchlist"` or `"rule"`.

Watchlist queries are plain text. Every whitespace-separated term must appear in the deal's title, category, or spec key, case-insensitively. A bare `under $200` or `<200` inside the query sets a price ceiling, as does the separate `max_price_cents` column.

Rule predicates are `{field, op, value}` clauses, all of which must hold. Fields are `priceCents`, `category`, `condition`, or any key inside `specs`. Ops are `lt`, `lte`, `gt`, `gte`, `eq`.

- [ ] **Step 1: Write the failing test**

`tests/rules.test.js`:

```js
import { describe, it, expect } from "vitest";
import { evaluateRules } from "../src/core/rules.js";

const deal = {
  cleanTitle: 'LG 27GR83Q 27" 1440p 240Hz IPS',
  category: "monitor",
  specKey: "monitor:27:1440p:240hz",
  priceCents: 6000,
  condition: "new",
  specs: { sizeInches: 27, refreshHz: 240, resolution: "1440p" },
};

const wl = (over) => ({ id: 1, label: "w", query: "", max_price_cents: null, ...over });
const rule = (over) => ({ id: 1, label: "r", category: "monitor", predicate_json: "[]", ...over });

describe("watchlist matching", () => {
  it("matches when every term appears", () => {
    const r = evaluateRules(deal, [wl({ query: "240hz monitor" })], []);
    expect(r.forceNotify).toBe(true);
    expect(r.matches[0].type).toBe("watchlist");
  });

  it("does not match when one term is missing", () => {
    expect(evaluateRules(deal, [wl({ query: "240hz oled" })], []).forceNotify).toBe(false);
  });

  it("is case insensitive", () => {
    expect(evaluateRules(deal, [wl({ query: "LG 240HZ" })], []).forceNotify).toBe(true);
  });

  it("searches the spec key as well as the title", () => {
    expect(evaluateRules(deal, [wl({ query: "1440p" })], []).forceNotify).toBe(true);
  });

  it("honours max_price_cents", () => {
    expect(evaluateRules(deal, [wl({ query: "240hz", max_price_cents: 5000 })], []).forceNotify).toBe(false);
    expect(evaluateRules(deal, [wl({ query: "240hz", max_price_cents: 20000 })], []).forceNotify).toBe(true);
  });

  it("parses an inline 'under $200' ceiling", () => {
    expect(evaluateRules(deal, [wl({ query: "240hz monitor under $200" })], []).forceNotify).toBe(true);
    expect(evaluateRules(deal, [wl({ query: "240hz monitor under $50" })], []).forceNotify).toBe(false);
  });

  it("does not treat the price words as required search terms", () => {
    expect(evaluateRules(deal, [wl({ query: "lg under $200" })], []).forceNotify).toBe(true);
  });

  it("accepts the < shorthand however it is spaced", () => {
    // A \b in front of the whole alternation only holds when < is glued to a
    // word char, so these all failed and the phrase stayed a search term.
    for (const q of ["lg < 200", "lg <200", "240hz monitor <200", "lg<200"]) {
      expect(evaluateRules(deal, [wl({ query: q })], []).forceNotify).toBe(true);
    }
  });

  it("still enforces the ceiling when written with <", () => {
    expect(evaluateRules(deal, [wl({ query: "lg < 50" })], []).forceNotify).toBe(false);
  });

  it("accepts the below and less than variants", () => {
    expect(evaluateRules(deal, [wl({ query: "lg below 200" })], []).forceNotify).toBe(true);
    expect(evaluateRules(deal, [wl({ query: "lg less than $200" })], []).forceNotify).toBe(true);
  });

  it("ignores an empty query", () => {
    expect(evaluateRules(deal, [wl({ query: "   " })], []).forceNotify).toBe(false);
  });

  it("reports every match", () => {
    const r = evaluateRules(deal, [wl({ id: 1, query: "lg" }), wl({ id: 2, query: "240hz" })], []);
    expect(r.matches).toHaveLength(2);
  });
});

describe("rule matching", () => {
  it("matches a price ceiling in the right category", () => {
    const r = evaluateRules(deal, [], [rule({ predicate_json: JSON.stringify([{ field: "priceCents", op: "lt", value: 20000 }]) })]);
    expect(r.forceNotify).toBe(true);
    expect(r.matches[0].type).toBe("rule");
  });

  it("does not match a different category", () => {
    const r = evaluateRules(deal, [], [rule({ category: "ssd", predicate_json: JSON.stringify([{ field: "priceCents", op: "lt", value: 20000 }]) })]);
    expect(r.forceNotify).toBe(false);
  });

  it("matches any category with the wildcard", () => {
    const r = evaluateRules(deal, [], [rule({ category: "*", predicate_json: JSON.stringify([{ field: "priceCents", op: "lt", value: 20000 }]) })]);
    expect(r.forceNotify).toBe(true);
  });

  it("requires every clause to hold", () => {
    const both = JSON.stringify([
      { field: "priceCents", op: "lt", value: 20000 },
      { field: "refreshHz", op: "gte", value: 240 },
    ]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: both })]).forceNotify).toBe(true);

    const impossible = JSON.stringify([
      { field: "priceCents", op: "lt", value: 20000 },
      { field: "refreshHz", op: "gte", value: 360 },
    ]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: impossible })]).forceNotify).toBe(false);
  });

  it("reads fields out of specs", () => {
    const p = JSON.stringify([{ field: "resolution", op: "eq", value: "1440p" }]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: p })]).forceNotify).toBe(true);
  });

  it("does not match when a field is absent", () => {
    const p = JSON.stringify([{ field: "capacityGb", op: "gte", value: 2048 }]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: p })]).forceNotify).toBe(false);
  });

  it("survives malformed predicate json without throwing", () => {
    expect(evaluateRules(deal, [], [rule({ predicate_json: "{{{" })]).forceNotify).toBe(false);
  });

  it("ignores an unknown operator", () => {
    const p = JSON.stringify([{ field: "priceCents", op: "wat", value: 1 }]);
    expect(evaluateRules(deal, [], [rule({ predicate_json: p })]).forceNotify).toBe(false);
  });

  it("treats an empty clause list as no match", () => {
    expect(evaluateRules(deal, [], [rule({ predicate_json: "[]" })]).forceNotify).toBe(false);
  });
});

describe("no configuration", () => {
  it("returns false with nothing configured", () => {
    const r = evaluateRules(deal, [], []);
    expect(r.forceNotify).toBe(false);
    expect(r.matches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/rules.test.js`
Expected: FAIL, cannot resolve `../src/core/rules.js`.

- [ ] **Step 3: Create `src/core/rules.js`**

```js
// Pure. No I/O. Watchlist and category rules force a notify independently of
// the score, so precision alerts survive any threshold setting.

// The \b goes inside each word alternative, not in front of the whole group.
// A leading \b before `<` only holds when `<` is glued to a word character, so
// `lg < 200` and `<200` would both fail to parse. The phrase then survives into
// the required search terms and the entry silently never matches anything.
const PRICE_PHRASE = /(?:\bunder|\bbelow|\bless than|<)\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/i;

const OPS = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  eq: (a, b) => a === b,
};

function haystack(deal) {
  return [deal.cleanTitle, deal.category, deal.specKey].filter(Boolean).join(" ").toLowerCase();
}

function matchesWatchlistEntry(deal, entry) {
  const raw = String(entry.query ?? "");
  const priceMatch = raw.match(PRICE_PHRASE);
  const ceilingFromQuery = priceMatch ? Math.round(parseFloat(priceMatch[1]) * 100) : null;
  const ceiling = entry.max_price_cents ?? ceilingFromQuery;

  const terms = raw
    .replace(PRICE_PHRASE, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return false;

  const hay = haystack(deal);
  if (!terms.every((t) => hay.includes(t))) return false;
  if (ceiling !== null && deal.priceCents > ceiling) return false;
  return true;
}

function fieldValue(deal, field) {
  if (field === "priceCents") return deal.priceCents;
  if (field === "category") return deal.category;
  if (field === "condition") return deal.condition;
  const specs = deal.specs ?? {};
  return Object.prototype.hasOwnProperty.call(specs, field) ? specs[field] : undefined;
}

function matchesRule(deal, rule) {
  if (rule.category !== "*" && rule.category !== deal.category) return false;
  let clauses;
  try {
    clauses = JSON.parse(rule.predicate_json);
  } catch {
    return false;
  }
  if (!Array.isArray(clauses) || !clauses.length) return false;
  return clauses.every((c) => {
    const op = OPS[c?.op];
    if (!op) return false;
    const value = fieldValue(deal, c.field);
    if (value === undefined || value === null) return false;
    return op(value, c.value);
  });
}

export function evaluateRules(deal, watchlist = [], rules = []) {
  const matches = [];
  for (const entry of watchlist) {
    if (matchesWatchlistEntry(deal, entry)) {
      matches.push({ type: "watchlist", id: entry.id, label: entry.label });
    }
  }
  for (const rule of rules) {
    if (matchesRule(deal, rule)) {
      matches.push({ type: "rule", id: rule.id, label: rule.label });
    }
  }
  return { forceNotify: matches.length > 0, matches };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/rules.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 5: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add watchlist and category rule evaluation"
```

**All five pure core modules now exist and are tested without a single network call. Everything after this point is plumbing.**

---

### Task 10: Reddit source adapter

**Files:**
- Create: `src/sources/reddit.js`, `tests/fixtures/reddit-buildapcsales.json`
- Test: `tests/source-reddit.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks. Adapters are standalone.
- Produces: `redditAdapter` object shaped `{id: "reddit", async list(env, config, fetchImpl?) -> RawItem[]}`.
  A `RawItem` is `{externalId, rawTitle, url, tag, postedAt, upvotes, comments, sellerRating}`.
  All adapters in later tasks produce this same shape, which is what makes `poll.js` source-agnostic.

Reddit application-only OAuth: POST `https://www.reddit.com/api/v1/access_token` with `grant_type=client_credentials` and HTTP Basic auth of `client_id:client_secret`, then read `https://oauth.reddit.com/r/{sub}/new?limit=50` with a Bearer token. Reddit requires a descriptive `User-Agent` and rejects generic ones.

- [ ] **Step 1: Create the fixture**

`tests/fixtures/reddit-buildapcsales.json` (a trimmed real-shape listing):

```json
{
  "kind": "Listing",
  "data": {
    "children": [
      {
        "kind": "t3",
        "data": {
          "id": "abc123",
          "title": "[Monitor] LG 27GR83Q 27\" 1440p 240Hz IPS - $60 (was $399)",
          "url": "https://www.amazon.com/dp/B0EXAMPLE",
          "permalink": "/r/buildapcsales/comments/abc123/monitor_lg/",
          "created_utc": 1800000000,
          "ups": 340,
          "num_comments": 41,
          "link_flair_text": "Monitor"
        }
      },
      {
        "kind": "t3",
        "data": {
          "id": "def456",
          "title": "[SSD] Samsung 990 Pro 2TB NVMe - $52 ($169)",
          "url": "https://www.newegg.com/p/EXAMPLE",
          "permalink": "/r/buildapcsales/comments/def456/ssd_samsung/",
          "created_utc": 1799999400,
          "ups": 88,
          "num_comments": 12,
          "link_flair_text": "SSD"
        }
      },
      {
        "kind": "t3",
        "data": {
          "id": "ghi789",
          "title": "[Meta] Subreddit rules reminder",
          "url": "https://www.reddit.com/r/buildapcsales/comments/ghi789/meta/",
          "permalink": "/r/buildapcsales/comments/ghi789/meta/",
          "created_utc": 1799990000,
          "ups": 12,
          "num_comments": 3,
          "link_flair_text": "Meta"
        }
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test**

`tests/source-reddit.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { redditAdapter, _resetTokenCache } from "../src/sources/reddit.js";
import fixture from "./fixtures/reddit-buildapcsales.json";

const env = { REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret" };

// The token cache is module scope, so it survives between tests in this file.
// Without this, whichever test runs second sees a warm token and the
// "sends basic auth to the token endpoint" assertion finds no token call.
beforeEach(() => _resetTokenCache());

function fakeFetch(handlers) {
  return vi.fn(async (url, init) => {
    for (const [pattern, fn] of handlers) {
      if (String(url).includes(pattern)) return fn(url, init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const tokenOk = ["access_token", async () => Response.json({ access_token: "tok", expires_in: 3600 })];
const listingOk = ["oauth.reddit.com", async () => Response.json(fixture)];

describe("redditAdapter", () => {
  it("returns one item per post", async () => {
    const items = await redditAdapter.list(env, { subreddits: ["buildapcsales"] }, fakeFetch([tokenOk, listingOk]));
    expect(items).toHaveLength(3);
  });

  it("maps fields into the RawItem shape", async () => {
    const items = await redditAdapter.list(env, { subreddits: ["buildapcsales"] }, fakeFetch([tokenOk, listingOk]));
    const first = items[0];
    expect(first.externalId).toBe("t3_abc123");
    expect(first.rawTitle).toContain("LG 27GR83Q");
    expect(first.url).toBe("https://www.amazon.com/dp/B0EXAMPLE");
    expect(first.tag).toBe("Monitor");
    expect(first.postedAt).toBe(1800000000);
    expect(first.upvotes).toBe(340);
    expect(first.comments).toBe(41);
    expect(first.sellerRating).toBe(null);
  });

  it("prefers the title tag over the flair", async () => {
    const custom = structuredClone(fixture);
    custom.data.children[0].data.link_flair_text = "Wrong";
    const items = await redditAdapter.list(env, { subreddits: ["x"] }, fakeFetch([tokenOk, ["oauth", async () => Response.json(custom)]]));
    expect(items[0].tag).toBe("Monitor");
  });

  it("falls back to the flair when the title has no tag", async () => {
    const custom = structuredClone(fixture);
    custom.data.children[0].data.title = "LG monitor deal - $60";
    const items = await redditAdapter.list(env, { subreddits: ["x"] }, fakeFetch([tokenOk, ["oauth", async () => Response.json(custom)]]));
    expect(items[0].tag).toBe("Monitor");
  });

  it("sends basic auth to the token endpoint", async () => {
    const f = fakeFetch([tokenOk, listingOk]);
    await redditAdapter.list(env, { subreddits: ["x"] }, f);
    const tokenCall = f.mock.calls.find((c) => String(c[0]).includes("access_token"));
    expect(tokenCall[1].headers.authorization).toBe(`Basic ${btoa("id:secret")}`);
    expect(tokenCall[1].headers["user-agent"]).toMatch(/undercut/i);
  });

  it("reads multiple subreddits", async () => {
    const f = fakeFetch([tokenOk, listingOk]);
    const items = await redditAdapter.list(env, { subreddits: ["a", "b"] }, f);
    expect(items).toHaveLength(6);
    const listingCalls = f.mock.calls.filter((c) => String(c[0]).includes("oauth"));
    expect(listingCalls).toHaveLength(2);
  });

  it("reuses a cached token across calls", async () => {
    const f = fakeFetch([tokenOk, listingOk]);
    await redditAdapter.list(env, { subreddits: ["a"] }, f);
    await redditAdapter.list(env, { subreddits: ["a"] }, f);
    const tokenCalls = f.mock.calls.filter((c) => String(c[0]).includes("access_token"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("throws when credentials are missing", async () => {
    await expect(redditAdapter.list({}, { subreddits: ["a"] }, fakeFetch([]))).rejects.toThrow(/credential/i);
  });

  it("throws when the token request fails", async () => {
    const f = fakeFetch([["access_token", async () => new Response("nope", { status: 401 })]]);
    await expect(redditAdapter.list(env, { subreddits: ["a"] }, f)).rejects.toThrow(/token/i);
  });

  it("throws when a listing request fails", async () => {
    const f = fakeFetch([tokenOk, ["oauth", async () => new Response("nope", { status: 429 })]]);
    await expect(redditAdapter.list(env, { subreddits: ["a"] }, f)).rejects.toThrow(/429/);
  });

  it("throws on a 200 that carries no children array", async () => {
    // Reddit answers 200 with {"reason":"private"} for private/banned subs.
    // Returning [] here would look exactly like a quiet day.
    const f = fakeFetch([tokenOk, ["oauth", async () => Response.json({ reason: "private" })]]);
    await expect(redditAdapter.list(env, { subreddits: ["a"] }, f)).rejects.toThrow(/children/i);
  });

  it("skips non-post children rather than emitting a degenerate item", async () => {
    const custom = structuredClone(fixture);
    custom.data.children.push({ kind: "more", data: { count: 12 } });
    const f = fakeFetch([tokenOk, ["oauth", async () => Response.json(custom)]]);
    const items = await redditAdapter.list(env, { subreddits: ["a"] }, f);
    expect(items).toHaveLength(3);
    expect(items.every((i) => !i.externalId.includes("undefined"))).toBe(true);
  });

  it("defaults to buildapcsales with no config", async () => {
    const f = fakeFetch([tokenOk, listingOk]);
    await redditAdapter.list(env, {}, f);
    expect(f.mock.calls.some((c) => String(c[0]).includes("buildapcsales"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/source-reddit.test.js`
Expected: FAIL, cannot resolve `../src/sources/reddit.js`.

- [ ] **Step 4: Create `src/sources/reddit.js`**

The token cache is module scope, which means per isolate. A cold isolate simply fetches a fresh token, so correctness never depends on the cache.

```js
// Dumb adapter. Fetches and shapes. Never scores, classifies, or writes.

const UA = "web:undercut:1.0 (private deal watcher)";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

let cachedToken = null; // { value, expiresAt }

export function _resetTokenCache() {
  cachedToken = null;
}

async function getToken(env, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    throw new Error("reddit credentials missing");
  }
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`reddit token request failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("reddit token missing from response");
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return cachedToken.value;
}

function titleTag(title) {
  const m = String(title ?? "").match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

function toRawItem(post) {
  return {
    externalId: `t3_${post.id}`,
    rawTitle: post.title ?? "",
    url: post.url ?? `https://www.reddit.com${post.permalink ?? ""}`,
    tag: titleTag(post.title) ?? post.link_flair_text ?? null,
    postedAt: Number.isFinite(post.created_utc) ? Math.round(post.created_utc) : null,
    upvotes: Number.isFinite(post.ups) ? post.ups : null,
    comments: Number.isFinite(post.num_comments) ? post.num_comments : null,
    sellerRating: null,
  };
}

export const redditAdapter = {
  id: "reddit",
  async list(env, config = {}, fetchImpl = fetch) {
    const subs = Array.isArray(config.subreddits) && config.subreddits.length
      ? config.subreddits
      : ["buildapcsales"];
    const token = await getToken(env, fetchImpl);

    const items = [];
    for (const sub of subs) {
      const res = await fetchImpl(`https://oauth.reddit.com/r/${encodeURIComponent(sub)}/new?limit=50`, {
        headers: { authorization: `Bearer ${token}`, "user-agent": UA },
      });
      if (!res.ok) throw new Error(`reddit listing failed for ${sub}: ${res.status}`);
      const data = await res.json();

      // A 200 with no children array is NOT an empty day. Reddit answers 200
      // with `{"reason":"private"}` for private, quarantined and banned
      // subreddits, and `?? []` would turn that into a silent zero-result poll
      // that looks identical to nothing being posted. Throw so source health
      // records it and the source eventually disables itself loudly.
      const children = data?.data?.children;
      if (!Array.isArray(children)) {
        throw new Error(`reddit listing for ${sub} returned no children array (private, banned, or shape changed)`);
      }

      for (const child of children) {
        // Skip "more" stubs and anything that is not a link post.
        if (child?.kind === "t3" && child.data) items.push(toRawItem(child.data));
      }
    }
    return items;
  },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/source-reddit.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 6: Update `docs/PROGRESS.md` and commit**

```bash
git add -A
git commit -m "feat: add reddit source adapter with oauth token caching"
```

---

### Task 11: RSS sources, Slickdeals and Woot

**Files:**
- Create: `src/sources/rss.js`, `src/sources/slickdeals.js`, `src/sources/woot.js`, `tests/fixtures/slickdeals.xml`, `tests/fixtures/woot.xml`
- Test: `tests/source-rss.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/sources/rss.js`: `parseRss(xmlText) -> [{title, link, pubDate, description, guid}]`
  - `src/sources/slickdeals.js`: `slickdealsAdapter` with the same `{id, list(env, config, fetchImpl?)}` shape as Task 10
  - `src/sources/woot.js`: `wootAdapter`, same shape

There is no XML parser in Workers, and adding a dependency is forbidden by the global constraints. A small regex reader is correct here because RSS item bodies are simple and we only need four fields. It must handle CDATA and basic entity unescaping.

- [ ] **Step 1: Create `tests/fixtures/slickdeals.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Slickdeals Computer Deals</title>
    <item>
      <title><![CDATA[LG 27GR83Q 27" 1440p 240Hz IPS Monitor - $60]]></title>
      <link>https://slickdeals.net/f/12345-lg-monitor</link>
      <pubDate>Tue, 04 Aug 2026 02:14:00 -0400</pubDate>
      <description><![CDATA[Lowest price we have tracked. Free shipping.]]></description>
      <guid>https://slickdeals.net/f/12345-lg-monitor</guid>
    </item>
    <item>
      <title>Samsung 990 Pro 2TB NVMe SSD - $52 (was $169)</title>
      <link>https://slickdeals.net/f/12346-samsung-ssd</link>
      <pubDate>Tue, 04 Aug 2026 01:40:00 -0400</pubDate>
      <description>Amazon &amp; Newegg price match</description>
      <guid>sd-12346</guid>
    </item>
  </channel>
</rss>
```

- [ ] **Step 2: Create `tests/fixtures/woot.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Woot Computers</title>
    <item>
      <title>Logitech G Pro X Superlight Wireless Mouse (Refurbished) - $18</title>
      <link>https://computers.woot.com/offers/logitech-g-pro-x</link>
      <pubDate>Mon, 03 Aug 2026 22:00:00 -0500</pubDate>
      <description><![CDATA[Factory reconditioned. 90 day Woot warranty.]]></description>
      <guid>woot-logitech-gpro</guid>
    </item>
  </channel>
</rss>
```

- [ ] **Step 3: Write the failing test**

`tests/source-rss.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { parseRss } from "../src/sources/rss.js";
import { slickdealsAdapter } from "../src/sources/slickdeals.js";
import { wootAdapter } from "../src/sources/woot.js";
// Vite `?raw` import, NOT node:fs. Every test file runs inside the workerd
// sandbox, which has no host disk access, so readFileSync cannot reach the
// fixture however the path is spelled (same issue as Task 3's setup.js).
// Vite inlines this at build time instead.
import slickXml from "./fixtures/slickdeals.xml?raw";
import wootXml from "./fixtures/woot.xml?raw";

const okWith = (body) => vi.fn(async () => new Response(body, { status: 200 }));

describe("parseRss", () => {
  it("reads every item", () => {
    expect(parseRss(slickXml)).toHaveLength(2);
  });

  it("unwraps CDATA", () => {
    expect(parseRss(slickXml)[0].title).toBe('LG 27GR83Q 27" 1440p 240Hz IPS Monitor - $60');
  });

  it("reads plain text titles", () => {
    expect(parseRss(slickXml)[1].title).toBe("Samsung 990 Pro 2TB NVMe SSD - $52 (was $169)");
  });

  it("unescapes entities", () => {
    expect(parseRss(slickXml)[1].description).toBe("Amazon & Newegg price match");
  });

  it("reads link, guid, and pubDate", () => {
    const item = parseRss(slickXml)[0];
    expect(item.link).toBe("https://slickdeals.net/f/12345-lg-monitor");
    expect(item.guid).toBe("https://slickdeals.net/f/12345-lg-monitor");
    expect(item.pubDate).toContain("04 Aug 2026");
  });

  it("returns an empty array for junk input", () => {
    expect(parseRss("not xml at all")).toEqual([]);
    expect(parseRss("")).toEqual([]);
    expect(parseRss(null)).toEqual([]);
  });

  it("ignores the channel title, which is not inside an item", () => {
    expect(parseRss(slickXml).some((i) => i.title === "Slickdeals Computer Deals")).toBe(false);
  });
});

describe("slickdealsAdapter", () => {
  it("maps items to the RawItem shape", async () => {
    const items = await slickdealsAdapter.list({}, {}, okWith(slickXml));
    expect(items).toHaveLength(2);
    expect(items[0].rawTitle).toContain("LG 27GR83Q");
    expect(items[0].url).toBe("https://slickdeals.net/f/12345-lg-monitor");
    expect(items[0].externalId).toBe("https://slickdeals.net/f/12345-lg-monitor");
    expect(items[0].tag).toBe(null);
    expect(items[0].upvotes).toBe(null);
    expect(typeof items[0].postedAt).toBe("number");
  });

  it("converts pubDate to unix seconds", async () => {
    const items = await slickdealsAdapter.list({}, {}, okWith(slickXml));
    expect(items[0].postedAt).toBe(Math.floor(Date.parse("Tue, 04 Aug 2026 02:14:00 -0400") / 1000));
  });

  it("throws on a failed fetch", async () => {
    const f = vi.fn(async () => new Response("err", { status: 503 }));
    await expect(slickdealsAdapter.list({}, {}, f)).rejects.toThrow(/503/);
  });

  it("throws when a 200 response is not a feed at all", async () => {
    // Bot challenge and error pages come back 200 with HTML. Parsing that to
    // zero items would look exactly like a quiet feed.
    const f = vi.fn(async () => new Response("<!doctype html><html><body>Access denied</body></html>", { status: 200 }));
    await expect(slickdealsAdapter.list({}, {}, f)).rejects.toThrow(/did not return RSS/i);
  });

  it("allows a valid feed that genuinely has no items", async () => {
    const quiet = '<?xml version="1.0"?><rss version="2.0"><channel><title>Quiet</title></channel></rss>';
    const f = vi.fn(async () => new Response(quiet, { status: 200 }));
    await expect(slickdealsAdapter.list({}, {}, f)).resolves.toEqual([]);
  });
});

describe("wootAdapter", () => {
  it("maps items and keeps the refurb wording in the title", async () => {
    const items = await wootAdapter.list({}, {}, okWith(wootXml));
    expect(items).toHaveLength(1);
    expect(items[0].rawTitle).toMatch(/Refurbished/);
    expect(items[0].externalId).toBe("woot-logitech-gpro");
  });

  it("fetches every configured feed", async () => {
    const f = okWith(wootXml);
    await wootAdapter.list({}, { feeds: ["computers", "electronics"] }, f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("throws on a failed fetch", async () => {
    const f = vi.fn(async () => new Response("err", { status: 500 }));
    await expect(wootAdapter.list({}, {}, f)).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/source-rss.test.js`
Expected: FAIL, cannot resolve `../src/sources/rss.js`.

- [ ] **Step 5: Create `src/sources/rss.js`**

```js
// Minimal RSS reader. Workers has no XML parser and runtime dependencies are
// forbidden, so this reads the four fields we need with regexes. RSS item
// bodies are simple enough that this is the right amount of machinery.

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'",
};

function unescapeXml(s) {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
}

function tag(block, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  let value = m[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) return cdata[1].trim();
  return unescapeXml(value);
}

export function parseRss(xmlText) {
  if (typeof xmlText !== "string" || !xmlText.includes("<item")) return [];
  const out = [];
  for (const match of xmlText.matchAll(ITEM_RE)) {
    const block = match[1];
    out.push({
      title: tag(block, "title"),
      link: tag(block, "link"),
      pubDate: tag(block, "pubDate"),
      description: tag(block, "description"),
      guid: tag(block, "guid"),
    });
  }
  return out;
}

export function toUnixSeconds(pubDate) {
  const ms = Date.parse(pubDate ?? "");
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function rssItemToRaw(item) {
  return {
    externalId: item.guid || item.link || item.title,
    rawTitle: item.title ?? "",
    url: item.link ?? "",
    tag: null,
    postedAt: toUnixSeconds(item.pubDate),
    upvotes: null,
    comments: null,
    sellerRating: null,
  };
}

export async function fetchFeed(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "user-agent": "undercut/1.0 (private deal watcher)" } });
  if (!res.ok) throw new Error(`feed fetch failed for ${url}: ${res.status}`);
  const text = await res.text();

  // A 200 is not proof we got a feed. Slickdeals and Woot both answer 200 with
  // an HTML error or bot-challenge page when they are unhappy, and parseRss
  // would quietly turn that into zero items, which is indistinguishable from a
  // quiet feed. Insist on an RSS-shaped root before parsing.
  //
  // Note the deliberate asymmetry with the Reddit adapter: zero `<item>`
  // elements INSIDE a valid RSS document is a legitimately quiet feed and stays
  // allowed. Only a non-feed response is an error.
  if (!/<(rss|feed|channel)\b/i.test(text)) {
    const head = text.slice(0, 60).replace(/\s+/g, " ").trim();
    throw new Error(`feed at ${url} did not return RSS (got: ${head})`);
  }
  return parseRss(text);
}
```

- [ ] **Step 6: Create `src/sources/slickdeals.js`**

```js
import { fetchFeed, rssItemToRaw } from "./rss.js";

const DEFAULT_FEED = "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1";

export const slickdealsAdapter = {
  id: "slickdeals",
  async list(env, config = {}, fetchImpl = fetch) {
    const url = config.feedUrl || DEFAULT_FEED;
    const items = await fetchFeed(url, fetchImpl);
    return items.map(rssItemToRaw);
  },
};
```

- [ ] **Step 7: Create `src/sources/woot.js`**

```js
import { fetchFeed, rssItemToRaw } from "./rss.js";

export const wootAdapter = {
  id: "woot",
  async list(env, config = {}, fetchImpl = fetch) {
    const feeds = Array.isArray(config.feeds) && config.feeds.length ? config.feeds : ["computers"];
    const out = [];
    for (const feed of feeds) {
      const items = await fetchFeed(`https://${feed}.woot.com/salerss`, fetchImpl);
      out.push(...items.map(rssItemToRaw));
    }
    return out;
  },
};
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/source-rss.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 9: Update `docs/PROGRESS.md` and commit**

```bash
git add -A
git commit -m "feat: add rss reader with slickdeals and woot adapters"
```

---

### Task 12: eBay source adapter

**Files:**
- Create: `src/sources/ebay.js`, `src/sources/index.js`, `tests/fixtures/ebay-search.json`
- Test: `tests/source-ebay.test.js`

**Interfaces:**
- Consumes: `redditAdapter`, `slickdealsAdapter`, `wootAdapter` from Tasks 10 and 11.
- Produces:
  - `src/sources/ebay.js`: `ebayAdapter` with the same `{id, list(env, config, fetchImpl?)}` shape, plus `_resetTokenCache()`
  - `src/sources/index.js`: `ADAPTERS` (a plain object keyed by source id) and `getAdapter(id)`

eBay's Browse API needs an application access token from `https://api.ebay.com/identity/v1/oauth2/token` using Basic auth and scope `https://api.ebay.com/oauth/api_scope`. Searches go to `https://api.ebay.com/buy/browse/v1/item_summary/search`.

The daily call budget is 5000 and the watchlist can grow without bound, so the adapter rotates: it takes the queries handed to it in `config.queries` and searches exactly one per poll, cycling by `config.cursor`. `poll.js` (Task 13) supplies the watchlist labels as queries and persists the advanced cursor.

- [ ] **Step 1: Create `tests/fixtures/ebay-search.json`**

```json
{
  "total": 2,
  "itemSummaries": [
    {
      "itemId": "v1|123456789|0",
      "title": "LG 27GR83Q 27in 1440p 240Hz Gaming Monitor Open Box",
      "itemWebUrl": "https://www.ebay.com/itm/123456789",
      "price": { "value": "210.00", "currency": "USD" },
      "marketingPrice": { "originalPrice": { "value": "599.00", "currency": "USD" } },
      "condition": "Open box",
      "seller": { "username": "techdeals", "feedbackPercentage": "99.2" },
      "itemCreationDate": "2026-08-04T06:14:00.000Z"
    },
    {
      "itemId": "v1|987654321|0",
      "title": "Samsung 990 Pro 2TB NVMe SSD New Sealed",
      "itemWebUrl": "https://www.ebay.com/itm/987654321",
      "price": { "value": "52.00", "currency": "USD" },
      "condition": "New",
      "seller": { "username": "flakyseller", "feedbackPercentage": "88.0" },
      "itemCreationDate": "2026-08-04T05:40:00.000Z"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`tests/source-ebay.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ebayAdapter, _resetTokenCache } from "../src/sources/ebay.js";
import { ADAPTERS, getAdapter } from "../src/sources/index.js";
import fixture from "./fixtures/ebay-search.json";

const env = { EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" };

beforeEach(() => _resetTokenCache());

function fakeFetch(handlers) {
  return vi.fn(async (url, init) => {
    for (const [pattern, fn] of handlers) {
      if (String(url).includes(pattern)) return fn(url, init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const tokenOk = ["oauth2/token", async () => Response.json({ access_token: "tok", expires_in: 7200 })];
const searchOk = ["item_summary/search", async () => Response.json(fixture)];

describe("ebayAdapter", () => {
  it("maps summaries to the RawItem shape", async () => {
    const items = await ebayAdapter.list(env, { queries: ["240hz monitor"] }, fakeFetch([tokenOk, searchOk]));
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first.externalId).toBe("v1|123456789|0");
    expect(first.rawTitle).toContain("LG 27GR83Q");
    expect(first.rawTitle).toContain("$210");
    expect(first.url).toBe("https://www.ebay.com/itm/123456789");
    expect(first.sellerRating).toBe(99.2);
    expect(first.postedAt).toBe(Math.floor(Date.parse("2026-08-04T06:14:00.000Z") / 1000));
  });

  it("appends the original price so parse-title can read a was-price", async () => {
    const items = await ebayAdapter.list(env, { queries: ["x"] }, fakeFetch([tokenOk, searchOk]));
    expect(items[0].rawTitle).toContain("$599");
  });

  it("carries the condition through in the title text", async () => {
    const items = await ebayAdapter.list(env, { queries: ["x"] }, fakeFetch([tokenOk, searchOk]));
    expect(items[0].rawTitle).toMatch(/open box/i);
  });

  it("reads a weak seller rating", async () => {
    const items = await ebayAdapter.list(env, { queries: ["x"] }, fakeFetch([tokenOk, searchOk]));
    expect(items[1].sellerRating).toBe(88);
  });

  it("searches exactly one query per poll", async () => {
    const f = fakeFetch([tokenOk, searchOk]);
    await ebayAdapter.list(env, { queries: ["a", "b", "c"] }, f);
    const searches = f.mock.calls.filter((c) => String(c[0]).includes("item_summary/search"));
    expect(searches).toHaveLength(1);
  });

  it("rotates by cursor", async () => {
    const f = fakeFetch([tokenOk, searchOk]);
    await ebayAdapter.list(env, { queries: ["alpha", "beta"], cursor: 1 }, f);
    const search = f.mock.calls.find((c) => String(c[0]).includes("item_summary/search"));
    expect(String(search[0])).toContain("beta");
  });

  it("wraps the cursor past the end of the list", async () => {
    const f = fakeFetch([tokenOk, searchOk]);
    await ebayAdapter.list(env, { queries: ["alpha", "beta"], cursor: 5 }, f);
    const search = f.mock.calls.find((c) => String(c[0]).includes("item_summary/search"));
    expect(String(search[0])).toContain("beta");
  });

  it("returns nothing when there are no queries", async () => {
    const f = fakeFetch([tokenOk, searchOk]);
    expect(await ebayAdapter.list(env, { queries: [] }, f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("handles an empty result set", async () => {
    const f = fakeFetch([tokenOk, ["item_summary/search", async () => Response.json({ total: 0 })]]);
    expect(await ebayAdapter.list(env, { queries: ["x"] }, f)).toEqual([]);
  });

  it("throws when credentials are missing", async () => {
    await expect(ebayAdapter.list({}, { queries: ["x"] }, fakeFetch([]))).rejects.toThrow(/credential/i);
  });

  it("throws on a failed search", async () => {
    const f = fakeFetch([tokenOk, ["item_summary/search", async () => new Response("no", { status: 500 })]]);
    await expect(ebayAdapter.list(env, { queries: ["x"] }, f)).rejects.toThrow(/500/);
  });
});

describe("adapter registry", () => {
  it("registers all four sources", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(["ebay", "reddit", "slickdeals", "woot"]);
  });

  it("looks an adapter up by id", () => {
    expect(getAdapter("woot").id).toBe("woot");
  });

  it("returns null for an unknown id", () => {
    expect(getAdapter("amazon")).toBe(null);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/source-ebay.test.js`
Expected: FAIL, cannot resolve `../src/sources/ebay.js`.

- [ ] **Step 4: Create `src/sources/ebay.js`**

The adapter folds price, original price, and condition into `rawTitle` rather than returning them as separate fields. That keeps the `RawItem` contract identical across all four sources, so `parse-title.js` stays the single place that understands prices.

```js
const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

let cachedToken = null;

export function _resetTokenCache() {
  cachedToken = null;
}

async function getToken(env, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error("ebay credentials missing");

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
  });
  if (!res.ok) throw new Error(`ebay token request failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("ebay token missing from response");
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in ?? 7200) };
  return cachedToken.value;
}

function dollars(priceObj) {
  const n = parseFloat(priceObj?.value ?? "");
  return Number.isFinite(n) ? n : null;
}

function toRawItem(summary) {
  const price = dollars(summary.price);
  const was = dollars(summary.marketingPrice?.originalPrice);
  // Fold price, was-price, and condition into the title so parse-title.js stays
  // the only module that understands prices.
  const parts = [summary.title ?? ""];
  if (summary.condition && !/new/i.test(summary.condition)) parts.push(`(${summary.condition})`);
  if (price !== null) parts.push(`- $${price.toFixed(2).replace(/\.00$/, "")}`);
  if (was !== null && price !== null && was > price) parts.push(`($${was.toFixed(2).replace(/\.00$/, "")})`);

  const rating = parseFloat(summary.seller?.feedbackPercentage ?? "");
  const created = Date.parse(summary.itemCreationDate ?? "");

  return {
    externalId: summary.itemId ?? summary.itemWebUrl,
    rawTitle: parts.join(" "),
    url: summary.itemWebUrl ?? "",
    tag: null,
    postedAt: Number.isFinite(created) ? Math.floor(created / 1000) : null,
    upvotes: null,
    comments: null,
    sellerRating: Number.isFinite(rating) ? rating : null,
  };
}

export const ebayAdapter = {
  id: "ebay",
  async list(env, config = {}, fetchImpl = fetch) {
    const queries = Array.isArray(config.queries) ? config.queries.filter(Boolean) : [];
    if (!queries.length) return [];

    const cursor = Number.isFinite(config.cursor) ? config.cursor : 0;
    const query = queries[cursor % queries.length];

    const token = await getToken(env, fetchImpl);
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&limit=50&sort=newlyListed`;
    const res = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    if (!res.ok) throw new Error(`ebay search failed: ${res.status}`);
    const data = await res.json();
    return (data.itemSummaries ?? []).map(toRawItem);
  },
};
```

- [ ] **Step 5: Create `src/sources/index.js`**

```js
import { redditAdapter } from "./reddit.js";
import { slickdealsAdapter } from "./slickdeals.js";
import { wootAdapter } from "./woot.js";
import { ebayAdapter } from "./ebay.js";

export const ADAPTERS = {
  reddit: redditAdapter,
  slickdeals: slickdealsAdapter,
  woot: wootAdapter,
  ebay: ebayAdapter,
};

export function getAdapter(id) {
  return ADAPTERS[id] ?? null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/source-ebay.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 7: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add ebay browse adapter with query rotation and source registry"
```

---

### Task 13: Notification decision, copy, and delivery

**Files:**
- Create: `src/core/notify-decision.js`, `src/notify.js`
- Modify: `src/config.js` (add `SOURCE_HEAT_BASELINE`)
- Test: `tests/notify.test.js`

**Interfaces:**
- Consumes: `sendPush` from `src/lib/webpush.js`, `listPushSubs`/`removePushSub` from `src/db/prefs.js`, `markNotified` from `src/db/deals.js`
- Produces:
  - `src/core/notify-decision.js` (pure): `shouldNotify({score, threshold, forceNotify, notifiedAt, notifiedPriceCents, priceCents}) -> {notify, reason}`, and `buildNotification({deal, reference, sourceName, matches}) -> {title, body}`
  - `src/notify.js`: `notifyDeal(env, deal, payload, nowSec) -> Promise<{sent, pruned}>`

Copy format is anomaly first, per spec section 10. Title carries price and item. Body leads with the unprecedented-price fact when history exists, and falls back to the stated discount when it does not.

- [ ] **Step 1: Add heat baselines to `src/config.js`**

Append to `src/config.js`:

```js
// Votes plus comments per minute that a normal post on this source attracts.
// Heat is scored as a ratio against this, so a source with no engagement
// signal simply contributes nothing.
export const SOURCE_HEAT_BASELINE = {
  reddit: 5,
  slickdeals: 0,
  woot: 0,
  ebay: 0,
};
```

- [ ] **Step 2: Write the failing test**

`tests/notify.test.js`:

```js
import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { shouldNotify, buildNotification } from "../src/core/notify-decision.js";
import { notifyDeal } from "../src/notify.js";
import { addPushSub, listPushSubs } from "../src/db/prefs.js";

const NOW = 1_800_000_000;

const dec = (over = {}) => ({
  score: 90, threshold: 78, forceNotify: false,
  notifiedAt: null, notifiedPriceCents: null, priceCents: 6000, ...over,
});

describe("shouldNotify", () => {
  it("fires above the threshold", () => {
    expect(shouldNotify(dec()).notify).toBe(true);
  });

  it("does not fire below the threshold", () => {
    expect(shouldNotify(dec({ score: 50 })).notify).toBe(false);
  });

  it("fires exactly at the threshold", () => {
    expect(shouldNotify(dec({ score: 78 })).notify).toBe(true);
  });

  it("fires on a rule match regardless of score", () => {
    const r = shouldNotify(dec({ score: 5, forceNotify: true }));
    expect(r.notify).toBe(true);
    expect(r.reason).toBe("rule");
  });

  it("does not fire twice for the same deal", () => {
    expect(shouldNotify(dec({ notifiedAt: NOW, notifiedPriceCents: 6000 })).notify).toBe(false);
  });

  it("does not re-fire on a trivial price drop", () => {
    const r = shouldNotify(dec({ notifiedAt: NOW, notifiedPriceCents: 6000, priceCents: 5800 }));
    expect(r.notify).toBe(false);
  });

  it("re-fires on a drop of 10 percent or more", () => {
    const r = shouldNotify(dec({ notifiedAt: NOW, notifiedPriceCents: 6000, priceCents: 5400 }));
    expect(r.notify).toBe(true);
    expect(r.reason).toBe("price-drop");
  });

  it("does not re-fire a rule match that was already notified", () => {
    const r = shouldNotify(dec({ score: 5, forceNotify: true, notifiedAt: NOW, notifiedPriceCents: 6000 }));
    expect(r.notify).toBe(false);
  });

  it("reports the score reason", () => {
    expect(shouldNotify(dec()).reason).toBe("score");
  });
});

describe("buildNotification", () => {
  const deal = {
    title: 'LG 27GR83Q 27" 1440p 240Hz IPS',
    price_cents: 6000,
    was_price_cents: 39900,
    posted_at: NOW - 40,
    condition: "new",
  };

  it("leads the title with the price", () => {
    const n = buildNotification({ deal, reference: { floorCents: 19800 }, sourceName: "r/buildapcsales", nowSec: NOW });
    expect(n.title.startsWith("$60")).toBe(true);
    expect(n.title).toContain("LG 27GR83Q");
  });

  it("leads the body with the unprecedented price when history exists", () => {
    const n = buildNotification({ deal, reference: { floorCents: 19800 }, sourceName: "r/buildapcsales", nowSec: NOW });
    expect(n.body).toContain("Never seen below $198");
    expect(n.body).toContain("40s ago");
    expect(n.body).toContain("r/buildapcsales");
  });

  it("falls back to the stated discount with no history", () => {
    const n = buildNotification({ deal, reference: null, sourceName: "woot", nowSec: NOW });
    expect(n.body).toContain("85% off");
    expect(n.body).not.toContain("Never seen");
  });

  it("says only how fresh it is when there is neither history nor a was-price", () => {
    const bare = { ...deal, was_price_cents: null };
    const n = buildNotification({ deal: bare, reference: null, sourceName: "woot", nowSec: NOW });
    expect(n.body).toContain("woot");
    expect(n.body).toMatch(/40s ago/);
  });

  it("does not claim an unprecedented price when the price is above the floor", () => {
    const n = buildNotification({ deal: { ...deal, price_cents: 25000 }, reference: { floorCents: 19800 }, sourceName: "x", nowSec: NOW });
    expect(n.body).not.toContain("Never seen");
  });

  it("names the watchlist entry that matched", () => {
    const n = buildNotification({
      deal, reference: null, sourceName: "woot", nowSec: NOW,
      matches: [{ type: "watchlist", label: "240hz under $200" }],
    });
    expect(n.title).toContain("240hz under $200");
  });

  it("shows minutes and hours for older posts", () => {
    const n5 = buildNotification({ deal: { ...deal, posted_at: NOW - 300 }, reference: null, sourceName: "x", nowSec: NOW });
    expect(n5.body).toContain("5m ago");
    const n2h = buildNotification({ deal: { ...deal, posted_at: NOW - 7200 }, reference: null, sourceName: "x", nowSec: NOW });
    expect(n2h.body).toContain("2h ago");
  });

  it("flags a non-new condition in the title", () => {
    const n = buildNotification({ deal: { ...deal, condition: "refurb" }, reference: null, sourceName: "x", nowSec: NOW });
    expect(n.title).toMatch(/refurb/i);
  });

  it("contains no em-dashes", () => {
    const n = buildNotification({ deal, reference: { floorCents: 19800 }, sourceName: "x", nowSec: NOW });
    expect(`${n.title} ${n.body}`).not.toContain("—");
  });
});

describe("notifyDeal", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM push_subscriptions").run();
    await env.DB.prepare("DELETE FROM notifications").run();
    await env.DB.prepare("DELETE FROM deals").run();
  });

  async function seedDeal() {
    const res = await env.DB.prepare(
      "INSERT INTO deals (fingerprint, source_id, title, url, price_cents, first_seen_at, last_seen_at) " +
        "VALUES ('fp','reddit','t','https://x.test',6000,?,?)"
    ).bind(NOW, NOW).run();
    return res.meta.last_row_id;
  }

  it("sends to every subscription", async () => {
    const id = await seedDeal();
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    await addPushSub(env.DB, { endpoint: "https://push.test/b", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: true, gone: false }));
    const r = await notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, send);
    expect(r.sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("prunes subscriptions the push service reports as gone", async () => {
    const id = await seedDeal();
    await addPushSub(env.DB, { endpoint: "https://push.test/dead", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: false, gone: true }));
    const r = await notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, send);
    expect(r.pruned).toBe(1);
    expect(await listPushSubs(env.DB)).toHaveLength(0);
  });

  it("marks the deal as notified", async () => {
    const id = await seedDeal();
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    await notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, async () => ({ ok: true, gone: false }));
    const row = await env.DB.prepare("SELECT * FROM deals WHERE id = ?").bind(id).first();
    expect(row.notified_at).toBe(NOW);
    expect(row.notified_price_cents).toBe(6000);
  });

  it("never throws when the push service errors", async () => {
    const id = await seedDeal();
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => { throw new Error("network down"); });
    await expect(notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, send)).resolves.toEqual({ sent: 0, pruned: 0 });
  });

  it("is a no-op with no subscriptions", async () => {
    const id = await seedDeal();
    const r = await notifyDeal(env, { id, price_cents: 6000 }, { title: "t", body: "b" }, NOW, async () => ({ ok: true }));
    expect(r).toEqual({ sent: 0, pruned: 0 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/notify.test.js`
Expected: FAIL, cannot resolve `../src/core/notify-decision.js`.

- [ ] **Step 4: Create `src/core/notify-decision.js`**

```js
// Pure. No I/O. Decides whether a deal is worth waking Samuel, and writes the
// copy that lands on the lock screen.

import { LIMITS } from "../config.js";

export function shouldNotify({
  score, threshold, forceNotify = false, notifiedAt = null,
  notifiedPriceCents = null, priceCents,
}) {
  if (notifiedAt) {
    // Already told him once. Only a materially cheaper price earns a second push.
    if (notifiedPriceCents && priceCents <= notifiedPriceCents * LIMITS.renotifyDropRatio) {
      return { notify: true, reason: "price-drop" };
    }
    return { notify: false, reason: "already-notified" };
  }
  if (forceNotify) return { notify: true, reason: "rule" };
  if (score >= threshold) return { notify: true, reason: "score" };
  return { notify: false, reason: "below-threshold" };
}

function money(cents) {
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

function ago(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "just now";
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function buildNotification({ deal, reference, sourceName, matches = [], nowSec = Math.floor(Date.now() / 1000) }) {
  const price = money(deal.price_cents);
  const conditionBits = deal.condition && deal.condition !== "new" ? ` (${deal.condition})` : "";
  const watch = matches.find((m) => m.type === "watchlist");
  const titleTail = watch ? ` [${watch.label}]` : "";
  const title = `${price} · ${deal.title}${conditionBits}${titleTail}`;

  const freshness = deal.posted_at ? ago(nowSec - deal.posted_at) : "just now";
  const tail = `Posted ${freshness} on ${sourceName}.`;

  let lead = null;
  if (reference?.floorCents && deal.price_cents < reference.floorCents) {
    lead = `Never seen below ${money(reference.floorCents)}.`;
  } else if (deal.was_price_cents && deal.was_price_cents > deal.price_cents) {
    const off = Math.round(((deal.was_price_cents - deal.price_cents) / deal.was_price_cents) * 100);
    lead = `${off}% off the usual ${money(deal.was_price_cents)}.`;
  }

  return { title, body: lead ? `${lead} ${tail}` : tail };
}
```

- [ ] **Step 5: Create `src/notify.js`**

Push is wrapped so it can never throw into the poll path, which is a global constraint.

```js
import { sendPush } from "./lib/webpush.js";
import { listPushSubs, removePushSub } from "./db/prefs.js";
import { markNotified } from "./db/deals.js";

export async function notifyDeal(env, deal, payload, nowSec, sendImpl = sendPush) {
  let sent = 0;
  let pruned = 0;
  try {
    const subs = await listPushSubs(env.DB);
    if (!subs.length) return { sent: 0, pruned: 0 };

    for (const sub of subs) {
      let result;
      try {
        result = await sendImpl(env, sub, payload);
      } catch {
        result = { ok: false, gone: false };
      }
      if (result.gone) {
        await removePushSub(env.DB, sub.endpoint);
        pruned++;
      } else if (result.ok) {
        sent++;
      }
      await env.DB
        .prepare("INSERT INTO notifications (deal_id, endpoint, sent_at, result) VALUES (?,?,?,?)")
        .bind(deal.id, sub.endpoint, nowSec, result.ok ? "ok" : result.gone ? "gone" : "failed")
        .run();
    }

    if (sent > 0) await markNotified(env.DB, deal.id, deal.price_cents, nowSec);
  } catch (e) {
    console.error("notifyDeal failed", e);
  }
  return { sent, pruned };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/notify.test.js`
Expected: PASS, 21 tests.

- [ ] **Step 6: Update `docs/PROGRESS.md` and commit**

```bash
git add -A
git commit -m "feat: add notification decision, anomaly-first copy, and delivery"
```

---

### Task 14: The poll pipeline

**Files:**
- Create: `src/poll.js`, `src/api/poll.js`
- Modify: `src/index.js` (register the poll route)
- Test: `tests/poll.test.js`

**Interfaces:**
- Consumes: everything built so far.
- Produces:
  - `src/poll.js`: `pollSource(env, sourceId, nowSec, deps?) -> Promise<{status, seen, stored, notified, skipped}>`. `deps` is `{fetchImpl, sendImpl}` for tests.
  - `src/api/poll.js`: `routePoll(request, env, url, path)` handling `POST /api/poll/:sourceId`

Pipeline order per item: parse, classify, fingerprint, upsert, append event, load reference, score, store score, evaluate rules, decide, notify. Items with no parseable price are skipped, not stored.

- [ ] **Step 1: Write the failing test**

`tests/poll.test.js`:

```js
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import worker from "../src/index.js";
import { pollSource } from "../src/poll.js";
import { signPollRequest } from "../src/lib/hmac-auth.js";
import { seedReferences } from "../src/db/refs.js";
import { addPushSub } from "../src/db/prefs.js";
import seedJson from "../seed/reference-prices.json";
import redditFixture from "./fixtures/reddit-buildapcsales.json";
import { _resetTokenCache } from "../src/sources/reddit.js";

const NOW = 1_800_000_000;

function fakeFetch() {
  return vi.fn(async (url) => {
    if (String(url).includes("access_token")) return Response.json({ access_token: "t", expires_in: 3600 });
    if (String(url).includes("oauth.reddit.com")) return Response.json(redditFixture);
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(async () => {
  _resetTokenCache();
  await env.DB.prepare("DELETE FROM notifications").run();
  await env.DB.prepare("DELETE FROM deal_events").run();
  await env.DB.prepare("DELETE FROM deals").run();
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
  await env.DB.prepare("DELETE FROM watchlist").run();
  await env.DB.prepare("DELETE FROM reference_prices").run();
  await env.DB.prepare("UPDATE sources SET last_polled_at = NULL, enabled = 1, consecutive_failures = 0, disabled_at = NULL").run();
  await env.DB.prepare("UPDATE prefs SET notify_threshold = 78 WHERE id = 1").run();
  await seedReferences(env.DB, seedJson, NOW);
});

describe("pollSource", () => {
  it("stores deals that have a parseable price", async () => {
    const r = await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    expect(r.status).toBe("ok");
    expect(r.seen).toBe(3);
    expect(r.stored).toBe(2);
    expect(r.skipped).toBe(1);
  });

  it("skips items with no price rather than storing junk", async () => {
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM deals WHERE title LIKE '%rules reminder%'").first();
    expect(row.n).toBe(0);
  });

  it("classifies and scores the monitor as an outlier", async () => {
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const row = await env.DB.prepare("SELECT * FROM deals WHERE category = 'monitor'").first();
    expect(row.spec_key).toBe("monitor:27:1440p:240hz");
    expect(row.price_cents).toBe(6000);
    expect(row.was_price_cents).toBe(39900);
    expect(row.score).toBeGreaterThanOrEqual(90);
  });

  it("appends a deal event per observation", async () => {
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM deal_events").first();
    expect(row.n).toBe(2);
  });

  it("pushes for the outlier and marks it notified", async () => {
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: true, gone: false }));
    const r = await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: send });
    expect(r.notified).toBeGreaterThanOrEqual(1);
    const row = await env.DB.prepare("SELECT * FROM deals WHERE category = 'monitor'").first();
    expect(row.notified_at).toBe(NOW);
  });

  it("does not notify the same deal twice across two polls", async () => {
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: true, gone: false }));
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: send });
    const firstCount = send.mock.calls.length;
    await pollSource(env, "reddit", NOW + 120, { fetchImpl: fakeFetch(), sendImpl: send });
    expect(send.mock.calls.length).toBe(firstCount);
  });

  it("updates in place rather than duplicating on a second poll", async () => {
    await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    await pollSource(env, "reddit", NOW + 120, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM deals").first();
    expect(row.n).toBe(2);
  });

  it("records a failure and never throws when the source errors", async () => {
    const boom = vi.fn(async () => { throw new Error("network down"); });
    const r = await pollSource(env, "reddit", NOW, { fetchImpl: boom, sendImpl: async () => ({ ok: true }) });
    expect(r.status).toBe("failed");
    const src = await env.DB.prepare("SELECT * FROM sources WHERE id = 'reddit'").first();
    expect(src.consecutive_failures).toBe(1);
  });

  it("auto-disables a source after three consecutive failures", async () => {
    const boom = vi.fn(async () => { throw new Error("down"); });
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare("UPDATE sources SET last_polled_at = NULL WHERE id = 'reddit'").run();
      await pollSource(env, "reddit", NOW + i, { fetchImpl: boom, sendImpl: async () => ({ ok: true }) });
    }
    const src = await env.DB.prepare("SELECT * FROM sources WHERE id = 'reddit'").first();
    expect(src.enabled).toBe(0);
  });

  it("clears the failure count after a success", async () => {
    const boom = vi.fn(async () => { throw new Error("down"); });
    await pollSource(env, "reddit", NOW, { fetchImpl: boom, sendImpl: async () => ({ ok: true }) });
    await env.DB.prepare("UPDATE sources SET last_polled_at = NULL WHERE id = 'reddit'").run();
    await pollSource(env, "reddit", NOW + 60, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    const src = await env.DB.prepare("SELECT * FROM sources WHERE id = 'reddit'").first();
    expect(src.consecutive_failures).toBe(0);
  });

  it("reports not-due without fetching", async () => {
    const f = fakeFetch();
    await pollSource(env, "reddit", NOW, { fetchImpl: f, sendImpl: async () => ({ ok: true }) });
    const callsAfterFirst = f.mock.calls.length;
    const r = await pollSource(env, "reddit", NOW + 5, { fetchImpl: f, sendImpl: async () => ({ ok: true }) });
    expect(r.status).toBe("not-due");
    expect(f.mock.calls.length).toBe(callsAfterFirst);
  });

  it("returns unknown-source for an id with no adapter", async () => {
    const r = await pollSource(env, "amazon", NOW, { fetchImpl: fakeFetch(), sendImpl: async () => ({ ok: true }) });
    expect(r.status).toBe("unknown-source");
  });

  it("fires a watchlist match below the score threshold", async () => {
    await env.DB.prepare("UPDATE prefs SET notify_threshold = 100 WHERE id = 1").run();
    await env.DB.prepare("INSERT INTO watchlist (label, query, created_at) VALUES ('ssd watch','990 pro',?)").bind(NOW).run();
    await addPushSub(env.DB, { endpoint: "https://push.test/a", p256dh: "k", auth: "a" }, NOW);
    const send = vi.fn(async () => ({ ok: true, gone: false }));
    const r = await pollSource(env, "reddit", NOW, { fetchImpl: fakeFetch(), sendImpl: send });
    expect(r.notified).toBe(1);
  });
});

describe("POST /api/poll/:source", () => {
  async function call(path, headers) {
    const req = new Request(`https://undercut.test${path}`, { method: "POST", headers });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }

  it("rejects an unsigned request", async () => {
    const res = await call("/api/poll/reddit", {});
    expect(res.status).toBe(401);
  });

  it("rejects a bad signature", async () => {
    const res = await call("/api/poll/reddit", { "x-uc-timestamp": String(NOW), "x-uc-signature": "deadbeef" });
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed request", async () => {
    const { timestamp, signature } = await signPollRequest(env.POLL_SECRET, "reddit");
    const res = await call("/api/poll/reddit", { "x-uc-timestamp": timestamp, "x-uc-signature": signature });
    expect([200, 204]).toContain(res.status);
  });

  it("404s an unknown source id", async () => {
    const { timestamp, signature } = await signPollRequest(env.POLL_SECRET, "amazon");
    const res = await call("/api/poll/amazon", { "x-uc-timestamp": timestamp, "x-uc-signature": signature });
    expect(res.status).toBe(404);
  });

  it("rejects GET", async () => {
    const { timestamp, signature } = await signPollRequest(env.POLL_SECRET, "reddit");
    const req = new Request("https://undercut.test/api/poll/reddit", {
      method: "GET", headers: { "x-uc-timestamp": timestamp, "x-uc-signature": signature },
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/poll.test.js`
Expected: FAIL, cannot resolve `../src/poll.js`.

- [ ] **Step 3: Create `src/poll.js`**

```js
import { getAdapter } from "./sources/index.js";
import { parseTitle } from "./core/parse-title.js";
import { classify } from "./core/classify.js";
import { fingerprint } from "./core/fingerprint.js";
import { scoreDeal } from "./core/score.js";
import { evaluateRules } from "./core/rules.js";
import { shouldNotify, buildNotification } from "./core/notify-decision.js";
import { getSource, isDue, markPolled, markSuccess, markFailure } from "./db/sources.js";
import { upsertDeal, appendEvent, getDeal, setScore } from "./db/deals.js";
import { getReference, updateLearned } from "./db/refs.js";
import { getPrefs, listWatchlist, listRules } from "./db/prefs.js";
import { notifyDeal } from "./notify.js";
import { CATEGORY_WEIGHTS, SOURCE_HEAT_BASELINE } from "./config.js";
import seedJson from "../seed/reference-prices.json";

const SOURCE_LABELS = {
  reddit: "r/buildapcsales",
  slickdeals: "Slickdeals",
  woot: "Woot",
  ebay: "eBay",
};

function heatFor(sourceId, item, nowSec) {
  const baseline = SOURCE_HEAT_BASELINE[sourceId] ?? 0;
  if (!baseline || item.upvotes === null) return null;
  const ageMin = Math.max(1, (nowSec - (item.postedAt ?? nowSec)) / 60);
  const velocity = ((item.upvotes ?? 0) + (item.comments ?? 0)) / ageMin;
  return { velocity, baseline };
}

async function refreshLearned(db, specKey, category, nowSec) {
  const { results } = await db
    .prepare("SELECT price_cents FROM deals WHERE spec_key = ? ORDER BY last_seen_at DESC LIMIT 100")
    .bind(specKey)
    .all();
  const prices = (results ?? []).map((r) => r.price_cents);
  await updateLearned(db, specKey, category, prices, seedJson, nowSec);
}

export async function pollSource(env, sourceId, nowSec, deps = {}) {
  const { fetchImpl = fetch, sendImpl } = deps;

  const adapter = getAdapter(sourceId);
  if (!adapter) return { status: "unknown-source", seen: 0, stored: 0, notified: 0, skipped: 0 };

  const source = await getSource(env.DB, sourceId);
  if (!source) return { status: "unknown-source", seen: 0, stored: 0, notified: 0, skipped: 0 };
  if (!isDue(source, nowSec)) return { status: "not-due", seen: 0, stored: 0, notified: 0, skipped: 0 };

  await markPolled(env.DB, sourceId, nowSec);

  let config = {};
  try {
    config = JSON.parse(source.config_json ?? "{}");
  } catch {
    config = {};
  }

  const prefs = await getPrefs(env.DB);
  const watchlist = await listWatchlist(env.DB);
  const rules = await listRules(env.DB);

  // eBay searches one watchlist query per poll to stay inside its daily budget.
  if (sourceId === "ebay") {
    config.queries = watchlist.map((w) => w.query).filter(Boolean);
    config.cursor = Number.isFinite(config.cursor) ? config.cursor : 0;
  }

  let items;
  try {
    items = await adapter.list(env, config, fetchImpl);
  } catch (e) {
    await markFailure(env.DB, sourceId, nowSec, e.message);
    return { status: "failed", seen: 0, stored: 0, notified: 0, skipped: 0, error: e.message };
  }

  let weights = CATEGORY_WEIGHTS;
  try {
    const custom = JSON.parse(prefs.weights_json ?? "{}");
    if (custom && typeof custom === "object") weights = { ...CATEGORY_WEIGHTS, ...custom };
  } catch { /* keep defaults */ }

  let stored = 0;
  let skipped = 0;
  let notified = 0;
  const touchedSpecs = new Map();

  for (const item of items) {
    const parsed = parseTitle(item.rawTitle);
    if (parsed.priceCents === null) { skipped++; continue; }

    const { category, specKey, specs } = classify(parsed.cleanTitle, { tag: item.tag });
    const fp = await fingerprint({ cleanTitle: parsed.cleanTitle, merchant: parsed.merchant, category, specKey });

    const { id } = await upsertDeal(env.DB, {
      fingerprint: fp,
      sourceId,
      externalId: item.externalId,
      title: parsed.cleanTitle || item.rawTitle,
      url: item.url,
      merchant: parsed.merchant,
      condition: parsed.condition,
      priceCents: parsed.priceCents,
      wasPriceCents: parsed.wasPriceCents,
      category,
      specKey,
      specs,
      postedAt: item.postedAt,
    }, nowSec);
    stored++;

    await appendEvent(env.DB, id, {
      priceCents: parsed.priceCents,
      upvotes: item.upvotes,
      comments: item.comments,
    }, nowSec);

    if (specKey) touchedSpecs.set(specKey, category);

    const refRow = await getReference(env.DB, specKey);
    const reference = refRow ? { typicalCents: refRow.typical_cents, floorCents: refRow.floor_cents } : null;

    const scored = scoreDeal({
      priceCents: parsed.priceCents,
      wasPriceCents: parsed.wasPriceCents,
      category,
      condition: parsed.condition,
      reference,
      heat: heatFor(sourceId, item, nowSec),
      sellerRating: item.sellerRating,
      weights,
    });
    await setScore(env.DB, id, scored.score, scored.reasons);

    const dealRow = await getDeal(env.DB, id);
    const ruled = evaluateRules(
      { cleanTitle: parsed.cleanTitle, category, specKey, priceCents: parsed.priceCents, condition: parsed.condition, specs },
      watchlist,
      rules
    );

    const decision = shouldNotify({
      score: scored.score,
      threshold: prefs.notify_threshold,
      forceNotify: ruled.forceNotify,
      notifiedAt: dealRow.notified_at,
      notifiedPriceCents: dealRow.notified_price_cents,
      priceCents: parsed.priceCents,
    });

    if (decision.notify) {
      const payload = buildNotification({
        deal: dealRow,
        reference,
        sourceName: SOURCE_LABELS[sourceId] ?? sourceId,
        matches: ruled.matches,
        nowSec,
      });
      const res = await notifyDeal(env, dealRow, payload, nowSec, sendImpl);
      if (res.sent > 0) notified++;
    }
  }

  for (const [specKey, category] of touchedSpecs) {
    await refreshLearned(env.DB, specKey, category, nowSec);
  }

  if (sourceId === "ebay" && config.queries?.length) {
    config.cursor = (config.cursor + 1) % config.queries.length;
    await env.DB
      .prepare("UPDATE sources SET config_json = ? WHERE id = 'ebay'")
      .bind(JSON.stringify({ ...config, queries: undefined }))
      .run();
  }

  await markSuccess(env.DB, sourceId, nowSec);
  return { status: "ok", seen: items.length, stored, notified, skipped };
}
```

- [ ] **Step 4: Create `src/api/poll.js`**

```js
import { json } from "../lib/http.js";
import { verifyPollRequest } from "../lib/hmac-auth.js";
import { getAdapter } from "../sources/index.js";
import { pollSource } from "../poll.js";

export async function routePoll(request, env, url, path) {
  const m = path.match(/^\/api\/poll\/([a-z0-9_-]+)$/i);
  if (!m) return null;
  const sourceId = m[1];

  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const timestamp = request.headers.get("x-uc-timestamp");
  const signature = request.headers.get("x-uc-signature");
  const ok = await verifyPollRequest(env.POLL_SECRET, sourceId, timestamp, signature);
  if (!ok) return json({ error: "unauthorized" }, 401);

  if (!getAdapter(sourceId)) return json({ error: "unknown source" }, 404);

  const result = await pollSource(env, sourceId, Math.floor(Date.now() / 1000));
  if (result.status === "not-due") return new Response(null, { status: 204 });
  return json(result);
}
```

- [ ] **Step 5: Register the route in `src/index.js`**

The poll endpoints are machine-to-machine and carry their own HMAC, so they must bypass the browser origin check. Add the import and put `routePoll` in the routers array:

```js
import { routePoll } from "./api/poll.js";

const routers = [routePoll];
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/poll.test.js`
Expected: PASS, 18 tests.

- [ ] **Step 7: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add poll pipeline wiring sources, scoring, rules, and push"
```

**Undercut is functionally complete at this point: it can poll, judge, and notify. Everything remaining is the interface Samuel uses to see and tune it.**

---

### Task 15: Auth API

**Files:**
- Create: `src/api/auth.js`
- Modify: `src/index.js` (origin check for browser routes, session gate, register router)
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` from `src/lib/crypto.js`, session helpers from `src/lib/session.js`, `getPrefs`/`setPrefs` from `src/db/prefs.js`
- Produces: `routeAuth(request, env, url, path)` and `requireSession(request, env) -> Promise<string>` which throws `HttpError(401)` when there is no valid session.

Single user. First run claims the instance by setting a password. Until `setup_done` is 1 the setup endpoint is open, which is why the deploy runbook (Task 21) flags claiming it immediately as urgent, exactly as My Email did.

- [ ] **Step 1: Write the failing test**

`tests/auth.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/auth.test.js`
Expected: FAIL, cannot resolve `../src/api/auth.js`.

- [ ] **Step 3: Create `src/api/auth.js`**

```js
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
```

- [ ] **Step 4: Update `src/index.js` to gate browser routes**

Poll endpoints carry their own HMAC and are called by a Worker with no `Origin` header, so they must sit outside both the origin check and the session gate.

```js
import { json, checkOrigin, HttpError } from "./lib/http.js";
import { routePoll } from "./api/poll.js";
import { routeAuth, requireSession } from "./api/auth.js";

const OPEN_PREFIXES = ["/api/auth/", "/api/health"];
const browserRouters = [routeAuth];

async function handleApi(request, env, url, path) {
  if (path === "/api/health") return json({ ok: true });

  // Machine endpoints: own auth, no origin check, no session.
  if (path.startsWith("/api/poll/")) {
    const res = await routePoll(request, env, url, path);
    if (res) return res;
    return json({ error: "not found" }, 404);
  }

  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && !checkOrigin(request)) {
    return json({ error: "origin check failed" }, 403);
  }

  if (!OPEN_PREFIXES.some((p) => path.startsWith(p))) {
    await requireSession(request, env);
  }

  for (const route of browserRouters) {
    const res = await route(request, env, url, path);
    if (res) return res;
  }
  return json({ error: "not found" }, 404);
}
```

Keep the existing `export default { async fetch(...) }` and its `HttpError` handling, which is what turns the thrown 401 into a JSON response.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/auth.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 6: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add single user auth with first run setup claim"
```

---

### Task 16: Read and settings API

**Files:**
- Create: `src/api/feed.js`, `src/api/settings.js`, `src/api/push.js`
- Modify: `src/index.js` (register the three routers)
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: `requireSession` from `src/api/auth.js`, the db layer, `listEvents` from `src/db/deals.js`
- Produces:
  - `routeFeed`: `GET /api/feed?minScore=&limit=`, `GET /api/deal/:id`
  - `routeSettings`: `GET /api/settings`, `PATCH /api/settings`, `GET|POST /api/watchlist`, `DELETE /api/watchlist/:id`, `GET|POST /api/rules`, `DELETE /api/rules/:id`, `POST /api/sources/:id/enable`
  - `routePush`: `GET /api/push/key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `POST /api/push/test`

- [ ] **Step 1: Write the failing test**

`tests/api.test.js`:

```js
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/index.js";
import { upsertDeal, appendEvent, setScore } from "../src/db/deals.js";

const ORIGIN = "https://undercut.test";
const NOW = 1_800_000_000;
let cookie;

async function raw(path, { method = "GET", body, withCookie = true } = {}) {
  const headers = { "content-type": "application/json", origin: ORIGIN };
  if (withCookie && cookie) headers.cookie = cookie;
  const req = new Request(`${ORIGIN}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM deal_events").run();
  await env.DB.prepare("DELETE FROM deals").run();
  await env.DB.prepare("DELETE FROM watchlist").run();
  await env.DB.prepare("DELETE FROM rules").run();
  await env.DB.prepare("DELETE FROM push_subscriptions").run();
  await env.DB.prepare("UPDATE prefs SET password_hash = NULL, setup_done = 0, notify_threshold = 78 WHERE id = 1").run();
  const res = await raw("/api/auth/setup", { method: "POST", body: { password: "a-long-enough-password" }, withCookie: false });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
});

async function seedDeal(over = {}) {
  const { id } = await upsertDeal(env.DB, {
    fingerprint: over.fingerprint ?? "fp1", sourceId: "reddit", title: 'LG 27" 240Hz',
    url: "https://x.test/1", priceCents: 6000, wasPriceCents: 39900,
    category: "monitor", specKey: "monitor:27:1440p:240hz", specs: { refreshHz: 240 },
    postedAt: NOW - 40, ...over,
  }, NOW);
  await setScore(env.DB, id, over.score ?? 99, [{ key: "outlier", label: "Outlier", points: 50, detail: "d" }]);
  return id;
}

describe("GET /api/feed", () => {
  it("requires a session", async () => {
    expect((await raw("/api/feed", { withCookie: false })).status).toBe(401);
  });

  it("returns deals newest first", async () => {
    await seedDeal({ fingerprint: "a" });
    await seedDeal({ fingerprint: "b" });
    const rows = await (await raw("/api/feed")).json();
    expect(rows.deals).toHaveLength(2);
  });

  it("filters by minScore", async () => {
    await seedDeal({ fingerprint: "a", score: 99 });
    await seedDeal({ fingerprint: "b", score: 10 });
    const rows = await (await raw("/api/feed?minScore=50")).json();
    expect(rows.deals).toHaveLength(1);
  });

  it("parses reasons into objects rather than returning raw json strings", async () => {
    await seedDeal();
    const rows = await (await raw("/api/feed")).json();
    expect(Array.isArray(rows.deals[0].reasons)).toBe(true);
    expect(rows.deals[0].reasons[0].key).toBe("outlier");
  });
});

describe("GET /api/deal/:id", () => {
  it("returns the deal, its reasons, and its price history", async () => {
    const id = await seedDeal();
    await appendEvent(env.DB, id, { priceCents: 7000 }, NOW - 600);
    await appendEvent(env.DB, id, { priceCents: 6000 }, NOW);
    const body = await (await raw(`/api/deal/${id}`)).json();
    expect(body.deal.price_cents).toBe(6000);
    expect(body.events).toHaveLength(2);
    expect(body.reasons[0].key).toBe("outlier");
  });

  it("includes the reference price when one exists", async () => {
    const id = await seedDeal();
    await env.DB.prepare(
      "INSERT OR REPLACE INTO reference_prices (spec_key, category, typical_cents, floor_cents, origin, sample_count, updated_at) " +
      "VALUES ('monitor:27:1440p:240hz','monitor',32000,19800,'seed',0,?)"
    ).bind(NOW).run();
    const body = await (await raw(`/api/deal/${id}`)).json();
    expect(body.reference.floor_cents).toBe(19800);
  });

  it("404s an unknown id", async () => {
    expect((await raw("/api/deal/999999")).status).toBe(404);
  });
});

describe("settings", () => {
  it("returns prefs and source health", async () => {
    const body = await (await raw("/api/settings")).json();
    expect(body.prefs.notify_threshold).toBe(78);
    expect(body.sources).toHaveLength(4);
  });

  it("patches the threshold", async () => {
    await raw("/api/settings", { method: "PATCH", body: { notify_threshold: 85 } });
    const body = await (await raw("/api/settings")).json();
    expect(body.prefs.notify_threshold).toBe(85);
  });

  it("rejects an out of range threshold", async () => {
    expect((await raw("/api/settings", { method: "PATCH", body: { notify_threshold: 500 } })).status).toBe(400);
    expect((await raw("/api/settings", { method: "PATCH", body: { notify_threshold: -1 } })).status).toBe(400);
  });

  it("never exposes the password hash", async () => {
    const body = await (await raw("/api/settings")).json();
    expect(body.prefs.password_hash).toBeUndefined();
  });

  it("re-enables a disabled source", async () => {
    await env.DB.prepare("UPDATE sources SET enabled = 0, consecutive_failures = 3, disabled_at = ? WHERE id = 'woot'").bind(NOW).run();
    await raw("/api/sources/woot/enable", { method: "POST" });
    const row = await env.DB.prepare("SELECT * FROM sources WHERE id = 'woot'").first();
    expect(row.enabled).toBe(1);
    expect(row.consecutive_failures).toBe(0);
  });
});

describe("watchlist and rules", () => {
  it("adds, lists, and deletes a watchlist entry", async () => {
    const created = await (await raw("/api/watchlist", { method: "POST", body: { label: "240hz", query: "240hz monitor" } })).json();
    expect((await (await raw("/api/watchlist")).json()).watchlist).toHaveLength(1);
    await raw(`/api/watchlist/${created.id}`, { method: "DELETE" });
    expect((await (await raw("/api/watchlist")).json()).watchlist).toHaveLength(0);
  });

  it("rejects a watchlist entry with no query", async () => {
    expect((await raw("/api/watchlist", { method: "POST", body: { label: "x", query: "  " } })).status).toBe(400);
  });

  it("adds a rule and validates its predicate", async () => {
    const ok = await raw("/api/rules", {
      method: "POST",
      body: { label: "cheap nvme", category: "ssd", predicate: [{ field: "priceCents", op: "lt", value: 8000 }] },
    });
    expect(ok.status).toBe(200);
    const bad = await raw("/api/rules", {
      method: "POST",
      body: { label: "bad", category: "ssd", predicate: [{ field: "priceCents", op: "wat", value: 1 }] },
    });
    expect(bad.status).toBe(400);
  });

  it("rejects a predicate that is not an array", async () => {
    const res = await raw("/api/rules", { method: "POST", body: { label: "x", category: "ssd", predicate: "nope" } });
    expect(res.status).toBe(400);
  });
});

describe("push", () => {
  it("returns the vapid public key without a session", async () => {
    const res = await raw("/api/push/key", { withCookie: false });
    expect(res.status).toBe(401);
  });

  it("returns the vapid public key with a session", async () => {
    const body = await (await raw("/api/push/key")).json();
    expect(body.publicKey).toBe("test-vapid-public");
  });

  it("subscribes and unsubscribes", async () => {
    const sub = { endpoint: "https://push.test/x", keys: { p256dh: "k", auth: "a" } };
    expect((await raw("/api/push/subscribe", { method: "POST", body: sub })).status).toBe(200);
    let row = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first();
    expect(row.n).toBe(1);
    await raw("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
    row = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first();
    expect(row.n).toBe(0);
  });

  it("rejects a malformed subscription", async () => {
    expect((await raw("/api/push/subscribe", { method: "POST", body: { endpoint: "x" } })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/api.test.js`
Expected: FAIL, cannot resolve `../src/api/feed.js`.

- [ ] **Step 3: Create `src/api/feed.js`**

```js
import { json } from "../lib/http.js";
import { listFeed, getDeal, listEvents } from "../db/deals.js";
import { getReference } from "../db/refs.js";
import { LIMITS } from "../config.js";

function withReasons(row) {
  let reasons = [];
  try {
    reasons = JSON.parse(row.score_reasons_json ?? "[]");
  } catch { /* leave empty */ }
  const { score_reasons_json, ...rest } = row;
  return { ...rest, reasons };
}

export async function routeFeed(request, env, url, path) {
  if (path === "/api/feed" && request.method === "GET") {
    // Clamp both, and clamp the low end too. SQLite treats a negative LIMIT as
    // unbounded, so `?limit=-1` would otherwise return the whole table.
    const rawMin = parseInt(url.searchParams.get("minScore") ?? "0", 10);
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const minScore = Number.isFinite(rawMin) ? Math.min(100, Math.max(0, rawMin)) : 0;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, LIMITS.maxFeedRows)
      : 100;
    const rows = await listFeed(env.DB, { minScore, limit });
    return json({ deals: rows.map(withReasons) });
  }

  const m = path.match(/^\/api\/deal\/(\d+)$/);
  if (m && request.method === "GET") {
    const deal = await getDeal(env.DB, parseInt(m[1], 10));
    if (!deal) return json({ error: "not found" }, 404);
    const events = await listEvents(env.DB, deal.id);
    const reference = await getReference(env.DB, deal.spec_key);
    const { reasons } = withReasons(deal);
    return json({ deal, reasons, events, reference });
  }

  return null;
}
```

- [ ] **Step 4: Create `src/api/settings.js`**

```js
import { json, readJson } from "../lib/http.js";
import { getPrefs, setPrefs, listWatchlist, listRules } from "../db/prefs.js";
import { listSources } from "../db/sources.js";

const VALID_OPS = ["lt", "lte", "gt", "gte", "eq"];

function publicPrefs(prefs) {
  const { password_hash, ...safe } = prefs;
  return safe;
}

export async function routeSettings(request, env, url, path) {
  if (path === "/api/settings" && request.method === "GET") {
    return json({ prefs: publicPrefs(await getPrefs(env.DB)), sources: await listSources(env.DB) });
  }

  if (path === "/api/settings" && request.method === "PATCH") {
    const body = await readJson(request);
    const patch = {};
    if (body.notify_threshold !== undefined) {
      const n = Number(body.notify_threshold);
      if (!Number.isInteger(n) || n < 0 || n > 100) return json({ error: "threshold must be 0 to 100" }, 400);
      patch.notify_threshold = n;
    }
    if (body.weights !== undefined) {
      if (typeof body.weights !== "object" || body.weights === null) return json({ error: "invalid weights" }, 400);
      patch.weights_json = JSON.stringify(body.weights);
    }
    await setPrefs(env.DB, patch);
    return json({ ok: true });
  }

  if (path === "/api/watchlist" && request.method === "GET") {
    return json({ watchlist: await listWatchlist(env.DB) });
  }

  if (path === "/api/watchlist" && request.method === "POST") {
    const { label, query, maxPriceCents } = await readJson(request);
    if (typeof query !== "string" || !query.trim()) return json({ error: "query required" }, 400);
    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB
      .prepare("INSERT INTO watchlist (label, query, max_price_cents, created_at) VALUES (?,?,?,?)")
      .bind(String(label ?? query).slice(0, 80), query.trim(), maxPriceCents ?? null, now)
      .run();
    return json({ ok: true, id: res.meta.last_row_id });
  }

  let m = path.match(/^\/api\/watchlist\/(\d+)$/);
  if (m && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM watchlist WHERE id = ?").bind(parseInt(m[1], 10)).run();
    return json({ ok: true });
  }

  if (path === "/api/rules" && request.method === "GET") {
    return json({ rules: await listRules(env.DB) });
  }

  if (path === "/api/rules" && request.method === "POST") {
    const { label, category, predicate } = await readJson(request);
    if (!Array.isArray(predicate) || !predicate.length) return json({ error: "predicate must be a non-empty array" }, 400);
    for (const clause of predicate) {
      if (!clause || typeof clause.field !== "string" || !VALID_OPS.includes(clause.op)) {
        return json({ error: "invalid predicate clause" }, 400);
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const res = await env.DB
      .prepare("INSERT INTO rules (label, category, predicate_json, created_at) VALUES (?,?,?,?)")
      .bind(String(label ?? "rule").slice(0, 80), String(category ?? "*"), JSON.stringify(predicate), now)
      .run();
    return json({ ok: true, id: res.meta.last_row_id });
  }

  m = path.match(/^\/api\/rules\/(\d+)$/);
  if (m && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(parseInt(m[1], 10)).run();
    return json({ ok: true });
  }

  m = path.match(/^\/api\/sources\/([a-z0-9_-]+)\/enable$/i);
  if (m && request.method === "POST") {
    await env.DB
      .prepare("UPDATE sources SET enabled = 1, consecutive_failures = 0, disabled_at = NULL WHERE id = ?")
      .bind(m[1])
      .run();
    return json({ ok: true });
  }

  return null;
}
```

- [ ] **Step 5: Create `src/api/push.js`**

```js
import { json, readJson } from "../lib/http.js";
import { addPushSub, removePushSub } from "../db/prefs.js";

export async function routePush(request, env, url, path) {
  if (path === "/api/push/key" && request.method === "GET") {
    return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
  }

  if (path === "/api/push/subscribe" && request.method === "POST") {
    const body = await readJson(request);
    const endpoint = body.endpoint;
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || !p256dh || !auth) {
      return json({ error: "invalid subscription" }, 400);
    }
    await addPushSub(env.DB, { endpoint, p256dh, auth }, Math.floor(Date.now() / 1000));
    return json({ ok: true });
  }

  if (path === "/api/push/unsubscribe" && request.method === "POST") {
    const { endpoint } = await readJson(request);
    if (typeof endpoint !== "string") return json({ error: "endpoint required" }, 400);
    await removePushSub(env.DB, endpoint);
    return json({ ok: true });
  }

  return null;
}
```

- [ ] **Step 6: Register the routers in `src/index.js`**

```js
import { routeFeed } from "./api/feed.js";
import { routeSettings } from "./api/settings.js";
import { routePush } from "./api/push.js";

const browserRouters = [routeAuth, routeFeed, routeSettings, routePush];
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/api.test.js`
Expected: PASS, 20 tests.

- [ ] **Step 8: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add feed, settings, watchlist, rules, and push api"
```

---

### Task 17: Ticker design system, feed, and deal detail

**Files:**
- Create: `public/app.css`, `public/app.js`
- Modify: `public/index.html`
- Test: manual screenshot verification (no vitest, this is presentation)

**Interfaces:**
- Consumes: `GET /api/feed`, `GET /api/deal/:id`, `GET /api/auth/state`, `POST /api/auth/login`, `POST /api/auth/setup`
- Produces: a hash-routed single page app. `#/` feed, `#/deal/:id` detail, `#/settings` (Task 18). `public/app.js` exports nothing; it is a script, not a module consumed elsewhere.

**Design direction is fixed and not open to reinterpretation.** Ticker: Undercut as a monitoring instrument, not a shopping app. Approved from a mockup Samuel picked over two alternatives.

- Monospace throughout (`ui-monospace, SFMono-Regular, Menlo, monospace`). Fixed-column rows, not cards.
- Score is a left gutter column, scanned vertically. Green `#4ad07a` for 90+, amber `#e8c14a` for 78 to 89, dim `#5b5c66` below. Colour is functional only.
- Dark: page `#0b0b0c`, panel `#111214`, hairline `#23242a`, text `#e8e8ea`, dim `#5b5c66`.
- Prices use `font-variant-numeric: tabular-nums` so columns align. Was-prices are struck through and dim.
- Source health lives in the top bar, never buried.
- No centred hero, no pill buttons, no card grid, no gradient. No em-dashes in any copy.

- [ ] **Step 1: Create `public/app.css`**

```css
:root {
  --bg: #0b0b0c;
  --panel: #111214;
  --line: #23242a;
  --line-soft: #17181c;
  --text: #e8e8ea;
  --dim: #5b5c66;
  --mid: #b9b9c2;
  --good: #4ad07a;
  --warm: #e8c14a;
  --bad: #ff4d4d;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

body { padding-bottom: env(safe-area-inset-bottom); }

.bar {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  padding-top: calc(10px + env(safe-area-inset-top));
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  z-index: 10;
}

.logo { font-weight: 700; font-size: 11px; letter-spacing: .22em; color: var(--mid); }
.logo a { color: inherit; text-decoration: none; }
.status { font-size: 10px; color: var(--good); }
.status.bad { color: var(--bad); }

.head, .row {
  display: grid;
  grid-template-columns: 34px 1fr 76px;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
}

.head {
  font-size: 9px;
  letter-spacing: .1em;
  color: var(--dim);
  border-bottom: 1px solid var(--line);
}

.row {
  border-bottom: 1px solid var(--line-soft);
  color: var(--mid);
  text-decoration: none;
  cursor: pointer;
}

.row:active { background: var(--panel); }

.sc { font-weight: 700; font-size: 13px; color: var(--dim); font-variant-numeric: tabular-nums; }
.sc.good { color: var(--good); }
.sc.warm { color: var(--warm); }

.nm {
  color: var(--text);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub { color: var(--dim); font-size: 9.5px; margin-top: 2px; }

.pr { text-align: right; font-variant-numeric: tabular-nums; }
.pr b { color: #fff; font-size: 13px; }
.pr s { display: block; color: var(--dim); font-size: 9px; }

.sec {
  font-size: 9px;
  letter-spacing: .12em;
  color: var(--dim);
  padding: 14px 12px 7px;
  border-bottom: 1px solid var(--line);
}

.pad { padding: 12px; }
.hero { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; }
.hero s { font-size: 13px; font-weight: 400; color: var(--dim); margin-left: 10px; }
.title { color: var(--text); font-size: 12px; line-height: 1.4; margin-bottom: 12px; }

.why { display: grid; grid-template-columns: 74px 38px 1fr; gap: 8px; padding: 5px 12px; font-size: 10.5px; color: var(--dim); }
.why .k { letter-spacing: .06em; }
.why .v { text-align: right; font-weight: 700; color: var(--good); font-variant-numeric: tabular-nums; }
.why .v.neg { color: var(--bad); }
.why .d { color: #7c7d88; }
.why.total { border-top: 1px solid var(--line); margin-top: 6px; padding-top: 9px; color: #fff; font-weight: 700; font-size: 12px; }

.spark { display: flex; align-items: flex-end; gap: 2px; height: 40px; padding: 10px 12px 0; }
.spark i { flex: 1; background: #2a2b31; border-radius: 1px; min-height: 2px; }
.spark i.now { background: var(--good); }

.btn {
  display: block;
  margin: 12px;
  padding: 12px;
  text-align: center;
  background: var(--good);
  color: #07120c;
  border: 0;
  border-radius: 4px;
  font-family: var(--mono);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: .1em;
  text-decoration: none;
  cursor: pointer;
}

.btn.ghost { background: transparent; color: var(--mid); border: 1px solid var(--line); }

.field {
  width: 100%;
  padding: 11px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
}

.empty { padding: 40px 16px; text-align: center; color: var(--dim); font-size: 11px; line-height: 1.6; }
.err { color: var(--bad); font-size: 11px; padding: 0 12px; }
```

- [ ] **Step 2: Create `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0b0c">
<title>Undercut</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div class="bar">
  <span class="logo"><a href="#/">UNDERCUT</a></span>
  <span class="status" id="status">...</span>
</div>
<main id="app"></main>
<script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `public/app.js` with the feed and detail screens**

```js
const app = document.getElementById("app");
const statusEl = document.getElementById("status");

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.hash = "#/login"; throw new Error("unauthorized"); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `error ${res.status}`);
  return res.json();
};

const money = (c) => {
  if (c === null || c === undefined) return "";
  const d = c / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
};

const ago = (sec) => {
  if (!sec) return "";
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 90) return `${Math.max(1, d)}s`;
  if (d < 5400) return `${Math.round(d / 60)}m`;
  if (d < 172800) return `${Math.round(d / 3600)}h`;
  return `${Math.round(d / 86400)}d`;
};

const scoreClass = (n) => (n >= 90 ? "good" : n >= 78 ? "warm" : "");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function paintStatus() {
  try {
    const { sources } = await api("/api/settings");
    const down = sources.filter((s) => !s.enabled);
    if (down.length) {
      statusEl.className = "status bad";
      statusEl.textContent = `${down.length} SOURCE${down.length > 1 ? "S" : ""} DOWN`;
    } else {
      statusEl.className = "status";
      statusEl.textContent = `${sources.length} SRC OK`;
    }
  } catch { statusEl.textContent = ""; }
}

async function screenFeed() {
  app.innerHTML = `<div class="head"><span>SCR</span><span>ITEM</span><span style="text-align:right">PRICE</span></div>
    <div id="rows"><div class="empty">Loading...</div></div>`;
  const { deals } = await api("/api/feed?limit=100");
  const rows = document.getElementById("rows");
  if (!deals.length) {
    rows.innerHTML = `<div class="empty">Nothing yet.<br>Undercut checks every source once a minute.</div>`;
    return;
  }
  rows.innerHTML = deals.map((d) => `
    <a class="row" href="#/deal/${d.id}">
      <span class="sc ${scoreClass(d.score)}">${d.score}</span>
      <span>
        <div class="nm">${esc(d.title)}</div>
        <div class="sub">${esc(d.source_id)} / ${ago(d.posted_at || d.first_seen_at)}${d.condition !== "new" ? " / " + esc(d.condition) : ""}</div>
      </span>
      <span class="pr"><b>${money(d.price_cents)}</b>${d.was_price_cents ? `<s>${money(d.was_price_cents)}</s>` : ""}</span>
    </a>`).join("");
}

async function screenDeal(id) {
  app.innerHTML = `<div class="empty">Loading...</div>`;
  const { deal, reasons, events, reference } = await api(`/api/deal/${id}`);

  const prices = events.map((e) => e.price_cents);
  const max = Math.max(...prices, deal.price_cents, reference?.typical_cents ?? 0) || 1;
  const bars = events.length
    ? events.map((e, i) => `<i class="${i === events.length - 1 ? "now" : ""}" style="height:${Math.round((e.price_cents / max) * 100)}%"></i>`).join("")
    : "";

  const total = reasons.reduce((n, r) => n + r.points, 0);

  app.innerHTML = `
    <div class="pad">
      <div class="title">${esc(deal.title)}</div>
      <div class="hero">${money(deal.price_cents)}${deal.was_price_cents ? `<s>${money(deal.was_price_cents)}</s>` : ""}</div>
    </div>
    <div class="sec">WHY THIS FIRED</div>
    <div style="padding-top:8px">
      ${reasons.map((r) => `<div class="why">
        <span class="k">${esc(r.label.toUpperCase())}</span>
        <span class="v ${r.points < 0 ? "neg" : ""}">${r.points > 0 ? "+" : ""}${r.points}</span>
        <span class="d">${esc(r.detail)}</span>
      </div>`).join("")}
      <div class="why total"><span>SCORE</span><span class="v">${deal.score}</span><span class="d">${total > 100 ? "capped from " + total : ""}</span></div>
    </div>
    ${events.length > 1 ? `<div class="sec">SEEN PRICES</div><div class="spark">${bars}</div>` : ""}
    ${reference ? `<div style="padding:8px 12px 0;font-size:9.5px;color:var(--dim)">
      LOW ${money(reference.floor_cents)} / TYPICAL ${money(reference.typical_cents)} / NOW ${money(deal.price_cents)}
    </div>` : ""}
    <a class="btn" href="${esc(deal.url)}" target="_blank" rel="noopener">OPEN AT RETAILER</a>
    <a class="btn ghost" href="#/">BACK TO FEED</a>`;
}

async function screenLogin() {
  const { setupDone } = await api("/api/auth/state");
  app.innerHTML = `
    <div class="pad">
      <div class="sub" style="margin-bottom:14px">${setupDone ? "Sign in to continue." : "Claim this instance by setting a password."}</div>
      <input class="field" id="pw" type="password" autocomplete="current-password" placeholder="password">
      <div class="err" id="err"></div>
      <button class="btn" id="go">${setupDone ? "SIGN IN" : "CLAIM"}</button>
    </div>`;
  document.getElementById("go").onclick = async () => {
    const password = document.getElementById("pw").value;
    try {
      await api(setupDone ? "/api/auth/login" : "/api/auth/setup", { method: "POST", body: { password } });
      location.hash = "#/";
      route();
    } catch (e) {
      document.getElementById("err").textContent = e.message;
    }
  };
}

async function route() {
  const hash = location.hash || "#/";
  try {
    if (hash === "#/login") return await screenLogin();
    const deal = hash.match(/^#\/deal\/(\d+)$/);
    if (deal) return await screenDeal(deal[1]);
    if (hash === "#/settings") return await screenSettings();
    await screenFeed();
    await paintStatus();
  } catch (e) {
    if (e.message !== "unauthorized") app.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

window.addEventListener("hashchange", route);
route();
```

`screenSettings` does not exist yet and Task 18 adds it. Until then, add a stub at the top of `app.js` so `#/settings` does not throw:

```js
async function screenSettings() { app.innerHTML = `<div class="empty">Settings arrive in the next task.</div>`; }
```

- [ ] **Step 4: Verify by screenshot**

Start the dev server, seed a deal, and capture the feed. The screenshot tool lives at the Websites root and is shared across projects.

```bash
npx wrangler dev --port 8787
```

In a second shell, claim the instance and insert a deal so the feed is not empty:

```bash
npx wrangler d1 execute undercut-db --local --command "UPDATE prefs SET setup_done=0, password_hash=NULL WHERE id=1"
```

Then in the browser at `http://localhost:8787`, claim with any 12+ character password, and insert a sample deal:

```bash
npx wrangler d1 execute undercut-db --local --command "INSERT INTO deals (fingerprint,source_id,title,url,price_cents,was_price_cents,category,spec_key,condition,posted_at,first_seen_at,last_seen_at,score,score_reasons_json) VALUES ('demo','reddit','LG 27GR83Q 27\" 1440p 240Hz IPS','https://example.test',6000,39900,'monitor','monitor:27:1440p:240hz','new',strftime('%s','now')-40,strftime('%s','now'),strftime('%s','now'),100,'[{\"key\":\"outlier\",\"label\":\"Outlier\",\"points\":50,\"detail\":\"70% below the observed floor of \$198\"},{\"key\":\"discount\",\"label\":\"Discount\",\"points\":25,\"detail\":\"85% off the stated \$399\"},{\"key\":\"heat\",\"label\":\"Heat\",\"points\":20,\"detail\":\"2.0x the usual activity\"},{\"key\":\"category\",\"label\":\"Category\",\"points\":19,\"detail\":\"monitor weighted 1.2x\"}]')"
```

Capture both screens:

```bash
node "../screenshot.js" "http://localhost:8787/#/" undercut-feed.png --width=390 --height=844
node "../screenshot.js" "http://localhost:8787/#/deal/1" undercut-deal.png --width=390 --height=844
```

Open both images and confirm against the design direction: monospace fixed columns, score gutter on the left in green, tabular price column right-aligned with a struck-through was-price, source health in the top bar, no cards, no gradients, nothing centred.

**Git Bash mangles `#` in URL arguments** via MSYS path translation. If the hash route does not load, quote the URL and prefix with `MSYS_NO_PATHCONV=1`. See `ClaudeBrain/Knowledge/Git Bash MSYS path-mangling of hash-route CLI args.md`.

- [ ] **Step 5: Update `docs/PROGRESS.md` and commit**

Commit the screenshots alongside the code so the visual state is reviewable.

```bash
git add -A
git commit -m "feat: add ticker design system with feed and deal detail screens"
```

---

### Task 18: Settings, watchlist, and rules screens

**Files:**
- Modify: `public/app.js` (replace the `screenSettings` stub)
- Test: manual screenshot verification

**Interfaces:**
- Consumes: `GET|PATCH /api/settings`, `GET|POST /api/watchlist`, `DELETE /api/watchlist/:id`, `GET|POST /api/rules`, `DELETE /api/rules/:id`, `POST /api/sources/:id/enable`, and the push endpoints from Task 16
- Produces: the `#/settings` screen. `enablePush()` is defined here and reused by Task 19.

Source health goes first on this screen. That ordering is deliberate: a silently dead source is the failure mode that costs Samuel deals, so it must be the first thing he sees.

- [ ] **Step 1: Replace the `screenSettings` stub in `public/app.js`**

```js
async function screenSettings() {
  const [{ prefs, sources }, { watchlist }, { rules }] = await Promise.all([
    api("/api/settings"), api("/api/watchlist"), api("/api/rules"),
  ]);

  app.innerHTML = `
    <div class="sec">SOURCES</div>
    <div id="sources">${sources.map((s) => `
      <div class="row" style="grid-template-columns:1fr auto">
        <span><div class="nm">${esc(s.name)}</div>
          <div class="sub">${s.last_success_at ? "last ok " + ago(s.last_success_at) + " ago" : "never succeeded"}</div></span>
        <span style="font-size:10.5px;color:${s.enabled ? "var(--good)" : "var(--bad)"}">
          ${s.enabled ? "OK" : `DOWN <button class="btn ghost" style="display:inline;margin:0 0 0 8px;padding:4px 8px" data-enable="${esc(s.id)}">RETRY</button>`}
        </span>
      </div>`).join("")}</div>

    <div class="sec">NOTIFY ABOVE</div>
    <div class="pad">
      <input type="range" min="0" max="100" value="${prefs.notify_threshold}" id="thr" style="width:100%">
      <div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--dim);margin-top:6px">
        <span>0</span><span id="thrv" style="color:var(--good)">${prefs.notify_threshold}</span><span>100</span>
      </div>
      <div class="sub" style="margin-top:9px">Raise this if the alerts get noisy. Rules and watchlist entries fire regardless.</div>
    </div>

    <div class="sec">WATCHING</div>
    <div id="wl">${watchlist.length ? watchlist.map((w) => `
      <div class="row" style="grid-template-columns:1fr auto">
        <span><div class="nm">${esc(w.label)}</div><div class="sub">${esc(w.query)}</div></span>
        <button class="btn ghost" style="margin:0;padding:5px 9px" data-del-wl="${w.id}">DELETE</button>
      </div>`).join("") : `<div class="empty">Nothing on the watchlist.</div>`}</div>
    <div class="pad">
      <input class="field" id="wlq" placeholder="240hz monitor under $200">
      <button class="btn" id="wladd">ADD TO WATCHLIST</button>
    </div>

    <div class="sec">RULES</div>
    <div id="rl">${rules.length ? rules.map((r) => `
      <div class="row" style="grid-template-columns:1fr auto">
        <span><div class="nm">${esc(r.label)}</div><div class="sub">${esc(r.category)} / ${esc(r.predicate_json)}</div></span>
        <button class="btn ghost" style="margin:0;padding:5px 9px" data-del-rule="${r.id}">DELETE</button>
      </div>`).join("") : `<div class="empty">No rules.</div>`}</div>

    <div class="sec">NOTIFICATIONS</div>
    <div class="pad">
      <button class="btn" id="push">ENABLE PUSH ON THIS DEVICE</button>
      <div class="sub" id="pushmsg">On iPhone, add Undercut to your home screen first. Push does not work in Safari tabs.</div>
    </div>
    <a class="btn ghost" href="#/">BACK TO FEED</a>`;

  const thr = document.getElementById("thr");
  thr.oninput = () => { document.getElementById("thrv").textContent = thr.value; };
  thr.onchange = async () => {
    await api("/api/settings", { method: "PATCH", body: { notify_threshold: Number(thr.value) } });
  };

  document.getElementById("wladd").onclick = async () => {
    const query = document.getElementById("wlq").value.trim();
    if (!query) return;
    await api("/api/watchlist", { method: "POST", body: { label: query, query } });
    route();
  };

  app.querySelectorAll("[data-del-wl]").forEach((b) => {
    b.onclick = async () => { await api(`/api/watchlist/${b.dataset.delWl}`, { method: "DELETE" }); route(); };
  });
  app.querySelectorAll("[data-del-rule]").forEach((b) => {
    b.onclick = async () => { await api(`/api/rules/${b.dataset.delRule}`, { method: "DELETE" }); route(); };
  });
  app.querySelectorAll("[data-enable]").forEach((b) => {
    b.onclick = async () => { await api(`/api/sources/${b.dataset.enable}/enable`, { method: "POST" }); route(); };
  });

  document.getElementById("push").onclick = enablePush;
}
```

- [ ] **Step 2: Add a settings link to the top bar**

In `public/index.html`, change the status span so the bar carries navigation:

```html
  <span class="status" id="status">...</span>
  <a href="#/settings" style="color:var(--dim);font-size:10px;text-decoration:none;letter-spacing:.1em">SET</a>
```

- [ ] **Step 3: Verify by screenshot**

```bash
node "../screenshot.js" "http://localhost:8787/#/settings" undercut-settings.png --width=390 --height=844
```

Confirm source health is the first section, the threshold slider reads back its value, and a disabled source shows a RETRY control.

- [ ] **Step 4: Update `docs/PROGRESS.md` and commit**

```bash
git add -A
git commit -m "feat: add settings screen with source health, threshold, watchlist, rules"
```

---

### Task 19: PWA shell, icons, service worker, and push subscription

**Files:**
- Create: `public/manifest.webmanifest`, `public/sw.js`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `scripts/make-icons.mjs`, `scripts/generate-vapid.mjs`
- Modify: `public/app.js` (add `enablePush`, register the service worker)
- Test: `tests/vapid.test.js`, plus manual iPhone verification at deploy time

**Interfaces:**
- Consumes: `GET /api/push/key`, `POST /api/push/subscribe` from Task 16, `generateVapidKeys` from `src/lib/webpush.js`
- Produces: `enablePush()` in `public/app.js`, called by the settings screen button from Task 18.

**The service worker must not proxy cross-origin requests.** A service worker `fetch()` is bound by the page's CSP `connect-src`, not `script-src`, so intercepting and re-fetching a third-party URL can silently break it from the second visit onward. See `ClaudeBrain/Knowledge/Service worker proxying cross-origin requests gets them CSP-blocked.md`. This worker only ever caches same-origin static assets, and passes everything else straight through untouched.

- [ ] **Step 1: Create `scripts/make-icons.mjs`**

No image dependencies are allowed, so this writes valid PNGs directly using `node:zlib`. The mark is the ticker score gutter: a dark square with a green bar down the left edge.

```js
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const bg = [0x0b, 0x0b, 0x0c];
  const accent = [0x4a, 0xd0, 0x7a];
  const barX = Math.round(size * 0.18);
  const barW = Math.round(size * 0.1);
  const pad = Math.round(size * 0.22);

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inBar = x >= barX && x < barX + barW && y >= pad && y < size - pad;
      const c = inBar ? accent : bg;
      raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2]; raw[o++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icons/icon-${size}.png`, import.meta.url), png(size));
  console.log(`wrote icon-${size}.png`);
}
```

Run it:

```bash
node scripts/make-icons.mjs
```

Open both files and confirm they render as images rather than being corrupt.

- [ ] **Step 2: Create `public/manifest.webmanifest`**

```json
{
  "name": "Undercut",
  "short_name": "Undercut",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0b0b0c",
  "theme_color": "#0b0b0c",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 3: Create `public/sw.js`**

```js
const CACHE = "undercut-v1";
const ASSETS = ["/", "/app.css", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only ever touch same-origin static GETs. Proxying a cross-origin request
  // from a service worker gets it blocked by the page CSP connect-src.
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;

  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
    )
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Undercut", body: "A deal is worth a look." };
  try { data = { ...data, ...e.data.json() }; } catch { /* keep defaults */ }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "undercut-deal",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || "/"));
});
```

Note: remove the stray character in the `showNotification` options object. The line should read `data: { url: data.url || "/" },` followed by `})`.

- [ ] **Step 4: Add `enablePush` and service worker registration to `public/app.js`**

```js
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  const msg = document.getElementById("pushmsg");
  const say = (t) => { if (msg) msg.textContent = t; };

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return say("This browser cannot do push. On iPhone, add Undercut to your home screen and open it from there.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return say("Notifications are blocked. Enable them in your device settings.");

  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api("/api/push/key");
    if (!publicKey) return say("No VAPID key is configured on the server.");
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = sub.toJSON();
    await api("/api/push/subscribe", {
      method: "POST",
      body: { endpoint: json.endpoint, keys: json.keys },
    });
    say("Push is on for this device.");
  } catch (e) {
    say(`Could not enable push: ${e.message}`);
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
```

- [ ] **Step 5: Create `scripts/generate-vapid.mjs`**

```js
// One shot VAPID keypair generator. Run once, then set the two secrets.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const b64url = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

console.log("VAPID_PUBLIC_KEY:");
console.log(b64url);
console.log("\nVAPID_PRIVATE_KEY (paste the whole line, it is JSON):");
console.log(JSON.stringify(privateJwk));
```

- [ ] **Step 6: Write a test proving the generated keys work with the push crypto**

`tests/vapid.test.js`:

```js
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
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run tests/vapid.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 8: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add pwa shell, icons, service worker, and push subscription"
```

---

### Task 20: The cron-pinger Worker

**Files:**
- Create: `cron-pinger/worker.js`, `cron-pinger/wrangler.toml`, `cron-pinger/DASHBOARD-PASTE.md`
- Test: `tests/pinger.test.js`

**Interfaces:**
- Consumes: `signPollRequest` logic, reimplemented standalone (the Worker is deployed separately and cannot import from `src/`)
- Produces: a `scheduled()` handler that fans out one signed POST per source.

The Worker is deliberately self-contained with no imports, so it can be pasted into the Cloudflare dashboard. Soda City Cubing's pinger was deployed exactly that way, which sidesteps needing a Workers-scoped API token.

- [ ] **Step 1: Write the failing test**

`tests/pinger.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/pinger.test.js`
Expected: FAIL, cannot resolve `../cron-pinger/worker.js`.

- [ ] **Step 3: Create `cron-pinger/worker.js`**

Self-contained by design. The HMAC is reimplemented here rather than imported because this file gets pasted into the dashboard as a single unit. It must stay byte-identical in behaviour to `src/lib/hmac-auth.js`, which the test enforces by verifying with the real implementation.

```js
// Undercut cron pinger. Wakes the Pages app once a minute and fans out one
// signed request per source, so each feed parse gets its own CPU budget
// instead of four sources sharing one invocation.
//
// Pages Functions cannot run cron. This tiny Worker is the reason why.
// Deploy by pasting into the Cloudflare dashboard (Workers, Create, paste),
// then set UNDERCUT_ORIGIN and POLL_SECRET. This code should never need to change.

const SOURCES = ["reddit", "slickdeals", "woot", "ebay"];

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async scheduled(_event, env, ctx, fetchImpl = fetch) {
    if (!env.UNDERCUT_ORIGIN || !env.POLL_SECRET) {
      console.error("pinger not configured: UNDERCUT_ORIGIN and POLL_SECRET required");
      return;
    }
    const origin = env.UNDERCUT_ORIGIN.replace(/\/+$/, "");
    const timestamp = String(Math.floor(Date.now() / 1000));

    const work = SOURCES.map(async (sourceId) => {
      try {
        const signature = await hmacHex(env.POLL_SECRET, `${sourceId}.${timestamp}`);
        await fetchImpl(`${origin}/api/poll/${sourceId}`, {
          method: "POST",
          headers: { "x-uc-timestamp": timestamp, "x-uc-signature": signature },
        });
      } catch (e) {
        console.error(`poll ping failed for ${sourceId}`, e);
      }
    });

    ctx.waitUntil(Promise.allSettled(work));
    await Promise.allSettled(work);
  },
};
```

- [ ] **Step 4: Create `cron-pinger/wrangler.toml`**

```toml
name = "undercut-pinger"
main = "worker.js"
compatibility_date = "2026-06-01"

[triggers]
crons = ["* * * * *"]
```

- [ ] **Step 5: Create `cron-pinger/DASHBOARD-PASTE.md`**

```markdown
# Deploying the pinger without a Workers API token

Pages-scoped Cloudflare tokens cannot deploy Workers. Rather than provisioning a
wider token, paste this Worker once through the dashboard. It never needs to
change afterwards.

1. Cloudflare dashboard, Workers and Pages, Create, Create Worker.
2. Name it `undercut-pinger`. Deploy the placeholder, then Edit Code.
3. Replace the contents with `worker.js` from this folder. Deploy.
4. Settings, Variables:
   - `UNDERCUT_ORIGIN` = `https://undercut.pages.dev` (no trailing slash)
   - `POLL_SECRET` = the same value set as a secret on the Pages app
   **Click Deploy after adding variables.** A variable is not live until you do.
   This exact step was missed once on My Email and cost real debugging time.
5. Settings, Triggers, Cron Triggers, Add: `* * * * *`.

## Verifying it works

Cloudflare dashboard, the Worker, Logs. You should see one invocation a minute
with four subrequests. On the Pages side, check that `sources.last_polled_at`
is advancing:

    npx wrangler d1 execute undercut-db --remote --command "SELECT id, last_polled_at, last_status, consecutive_failures FROM sources"
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/pinger.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the whole suite, update `docs/PROGRESS.md`, and commit**

```bash
npx vitest run
git add -A
git commit -m "feat: add cron pinger worker with per-source signed fan-out"
```

---

### Task 21: Deploy runbook and final review

**Files:**
- Create: `README.md`
- Modify: `docs/PROGRESS.md`
- Test: full suite plus a live end-to-end check

**Interfaces:**
- Consumes: everything.
- Produces: a runbook Samuel can follow, and a deployed instance.

- [ ] **Step 1: Create `README.md`**

````markdown
# Undercut

Private tech deal hunter. Polls community deal feeds every minute, scores each
deal against learned price history, and pushes an iPhone when something
genuinely exceptional appears.

Spec: `docs/superpowers/specs/2026-07-25-undercut-design.md`
Build log: `docs/PROGRESS.md`

## Local development

```bash
npm install
npx wrangler d1 create undercut-db          # once, paste the id into wrangler.toml
npx wrangler d1 execute undercut-db --local --file=./schema.sql
npx wrangler dev --port 8787
```

Tests: `npx vitest run`

## What you need before deploying

All free, all one-time.

1. **Reddit OAuth app.** reddit.com/prefs/apps, Create App, type `script`.
   Redirect URI can be `http://localhost`. Keep the client ID (under the app
   name) and the secret.
2. **eBay developer key.** developer.ebay.com, create a Production keyset.
   Keep the App ID (client ID) and Cert ID (client secret).
3. **VAPID keys.** `npm run vapid`, keep both lines it prints.
4. **A random `POLL_SECRET` and `SESSION_SECRET`.** Any long random strings.

## Deploy

```bash
npm run build:pages
npx wrangler pages project create undercut
npm run deploy:pages
npx wrangler d1 execute undercut-db --remote --file=./schema.sql
```

Bind D1 to the Pages project (dashboard, Pages, undercut, Settings, Functions,
D1 bindings): binding name `DB`, database `undercut-db`.

Set secrets on the Pages project (dashboard, Settings, Environment variables,
Production, Encrypt):

| Name | Value |
|---|---|
| `SESSION_SECRET` | long random string |
| `POLL_SECRET` | long random string, same one the pinger uses |
| `REDDIT_CLIENT_ID` | from step 1 |
| `REDDIT_CLIENT_SECRET` | from step 1 |
| `EBAY_CLIENT_ID` | from step 2 |
| `EBAY_CLIENT_SECRET` | from step 2 |
| `VAPID_PUBLIC_KEY` | from step 3 |
| `VAPID_PRIVATE_KEY` | from step 3, the whole JSON line |
| `VAPID_SUBJECT` | `mailto:you@example.com` |
| `PUBLIC_ORIGIN` | `https://undercut.pages.dev` |

Redeploy after setting variables so they take effect.

Then deploy the pinger: `cron-pinger/DASHBOARD-PASTE.md`.

## Claim the instance immediately

**Until you set a password, anyone who finds the URL can claim it.** Open
`https://undercut.pages.dev` and set one as the very first thing after deploy.

## Turn on notifications

On the iPhone: open the site in Safari, Share, Add to Home Screen. Open it from
the home screen icon, not from Safari. Settings, Enable Push. iOS will not offer
push in a Safari tab at all.

## Diagnosing

Nothing arriving:

```bash
# Are sources being polled?
npx wrangler d1 execute undercut-db --remote --command "SELECT id, last_polled_at, last_success_at, last_status, consecutive_failures, enabled FROM sources"

# Are deals being stored and scored?
npx wrangler d1 execute undercut-db --remote --command "SELECT id, score, price_cents, title FROM deals ORDER BY last_seen_at DESC LIMIT 10"

# Were pushes attempted?
npx wrangler d1 execute undercut-db --remote --command "SELECT * FROM notifications ORDER BY sent_at DESC LIMIT 10"
```

If `last_polled_at` is not advancing, the pinger is not running or its
`POLL_SECRET` does not match. If deals are stored but nothing pushes, either the
threshold is too high or there are no push subscriptions.

You can trigger a poll by hand. Compute the signature over `<sourceId>.<unix>`:

```bash
node -e 'const s=process.argv[1],id=process.argv[2],t=Math.floor(Date.now()/1000);const c=require("crypto");console.log(t, c.createHmac("sha256",s).update(id+"."+t).digest("hex"))' "$POLL_SECRET" reddit
```

then POST with `x-uc-timestamp` and `x-uc-signature`.
````

- [ ] **Step 2: Run the full suite and confirm the count**

Run: `npx vitest run`
Expected: PASS. Record the exact total in `docs/PROGRESS.md`.

- [ ] **Step 3: Verify the two spec assumptions**

Spec section 17 lists two claims that were asserted rather than measured. Settle them now and write the answers into `docs/PROGRESS.md`.

1. **Free-tier CPU per poll.** After the first live ticks, check the Pages
   Functions invocation metrics for CPU time on `/api/poll/reddit`. If any
   source exceeds the free allowance, shard that source's parsing across ticks
   by slicing `items` and storing an offset in `sources.config_json`.
2. **Reddit and datacenter IPs.** Temporarily point the reddit adapter at
   `https://www.reddit.com/r/buildapcsales/new.json` without a token and see
   whether it returns JSON or a block page from a deployed Worker. If plain
   access works, the OAuth dependency can be dropped. Record the finding either
   way.

- [ ] **Step 4: Deploy and verify end to end**

Follow the README. Then confirm, in order: the site loads, you can claim it, the
feed populates within a few minutes, source health shows all four OK, and a test
deal pushes to the iPhone home screen app.

- [ ] **Step 5: Request a code review**

Use the `superpowers:requesting-code-review` skill over the whole branch before
considering this done. My Email's final whole-branch review caught two Important
issues that per-task reviews had missed, including a D1 bound-parameter limit
that local SQLite could never have surfaced.

- [ ] **Step 6: File the outcome to the vault**

Update `ClaudeBrain/Projects/Undercut.md`: status, the real `Run & verify`
commands, and a Recent activity line. Write a session note. Promote any gotcha
that cost real time into `ClaudeBrain/Knowledge/`, especially the answers to the
two assumptions above.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "docs: add deploy runbook and finish v1"
```

---

## Self-Review

Checked after writing, against `docs/superpowers/specs/2026-07-25-undercut-design.md`.

**Spec coverage.** Section 4 architecture is Tasks 1, 14, 20. Section 5 modules
map to Tasks 4, 5, 6, 8, 9 (core), 10, 11, 12 (sources), 3 (db), 15, 16 (api).
Section 6 sources are Tasks 10 to 12. Section 7 data model is Task 3. Section 8
scoring is Tasks 7 and 8. Section 9 watchlist and rules is Task 9, surfaced in
Tasks 16 and 18. Section 10 notifications is Task 13. Section 11 UI is Tasks 17
to 19. Section 12 failure handling is Task 3 (`markFailure` escalation), Task 14
(wrapped adapters), Task 13 (push never throws), Task 18 (health on screen).
Section 14 security is Tasks 2 and 15. Section 15 testing is spread across every
task. Section 16 deployment is Tasks 20 and 21. Section 17 assumptions are
Task 21 step 3.

Two spec items deserve an explicit note rather than a silent pass:

- **The "source is down" push** described in spec section 12 is not implemented
  as a push. `markFailure` auto-disables at three failures and Task 18 surfaces
  it prominently in the top bar and settings screen, but no notification is sent.
  Adding it means a second notification path with its own dedupe, and the visible
  status covers the need at a glance. **Flagged for Samuel:** if you want the
  outage to buzz your phone rather than wait for you to open the app, say so and
  it becomes a small addition to Task 13.
- **Category weights are editable through the API** (Task 16 `PATCH /api/settings`
  accepts `weights`) but Task 18's settings screen has no control for them. The
  defaults in `config.js` are sensible and this is tuning, not core function.

**Placeholder scan.** No TBDs, and no code blocks that are knowingly wrong. An
earlier draft embedded two broken lines with corrections underneath and walked
Task 3 through an `applyD1Migrations` dead end; all three are now written
correctly the first time, because a task read out of order would have
implemented the broken version.

**Type consistency.** `RawItem` is `{externalId, rawTitle, url, tag, postedAt,
upvotes, comments, sellerRating}` in Tasks 10, 11, and 12 alike. `parseTitle`
returns `{cleanTitle, priceCents, wasPriceCents, merchant, condition}` and Task 14
consumes exactly those. `classify` returns `{category, specKey, specs}`,
consumed as such. `scoreDeal` returns `{score, subtotal, capped, reasons}` and
Task 16 serialises `reasons` from `score_reasons_json`. `shouldNotify` and
`buildNotification` signatures match their Task 14 call sites. Database column
names in Task 3's schema match every query in Tasks 13 to 16.

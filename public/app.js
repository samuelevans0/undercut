const app = document.getElementById("app");
const statusEl = document.getElementById("status");

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
        <span><div class="nm">${esc(w.label)}</div><div class="sub">${esc(w.query)} / ${w.hit_count} hit${w.hit_count === 1 ? "" : "s"}</div></span>
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

  // Deferred as a closure rather than `onclick = enablePush` directly: T19
  // hasn't defined enablePush yet, and a bare reference to an undeclared
  // identifier throws ReferenceError the instant this line *evaluates*, not
  // when the button is later clicked, which would blank the whole screen on
  // every render before T19 lands. Wrapping it defers that throw to click
  // time, matching the intended "ReferenceError on click" behavior.
  document.getElementById("push").onclick = () => enablePush();
}

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

// Only http(s) links are ever clickable. esc() stops attribute breakout but
// leaves a `javascript:` scheme intact, and deal.url arrives straight from
// third-party feeds. No base URL on purpose: feed links are always absolute,
// so anything relative or malformed is rejected rather than silently
// resolving against our own origin.
const safeUrl = (u) => {
  try {
    const parsed = new URL(String(u ?? ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
};

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
    ${(() => {
      const href = safeUrl(deal.url);
      return href
        ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">OPEN AT RETAILER</a>`
        : `<div class="btn ghost" style="cursor:default">LINK UNAVAILABLE</div>`;
    })()}
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

    // Status belongs to the chrome, not to the feed screen. Painting it only
    // in the feed branch left the bar reading "..." on every other route.
    // Deliberately not awaited: it has its own try/catch and must not delay
    // the screen render.
    paintStatus();

    const deal = hash.match(/^#\/deal\/(\d+)$/);
    if (deal) return await screenDeal(deal[1]);
    if (hash === "#/settings") return await screenSettings();
    await screenFeed();
  } catch (e) {
    if (e.message !== "unauthorized") app.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

window.addEventListener("hashchange", route);
route();

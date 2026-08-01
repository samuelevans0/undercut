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

  // Network first, cache only as the offline fallback. Cache-first would
  // strand an installed PWA on whatever shell it saw the day it was
  // installed: a deploy changing app.js would never reach it unless CACHE
  // were bumped by hand, and a byte-identical sw.js would not even trigger
  // an update check. Freshness matters more here than a few hundred ms, and
  // the cache still covers being genuinely offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || Response.error()))
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

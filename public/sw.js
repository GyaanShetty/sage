/* SAGE service worker — network-first for navigations, cache shell for offline. */
const CACHE = "sage-v2";
const SHELL = ["/dashboard", "/icon-192-v2.png", "/icon-512-v2.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// --- Web Push -------------------------------------------------------------
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "SAGE", body: e.data ? e.data.text() : "" };
  }
  const title = data.title || "SAGE";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "sage",
      icon: "/icon-192-v2.png",
      badge: "/icon-192-v2.png",
      data: { url: data.url || "/dashboard" },
      vibrate: [40, 30, 40],
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/dashboard";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.focus();
          if ("navigate" in c) c.navigate(url).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /**
   * Only our own origin.
   *
   * This used to intercept every GET, third-party included — and the offline
   * fallback below answers a failed request with the dashboard's HTML. So a
   * Spotify album image that failed to load was served our page instead, and
   * the browser then parsed that HTML with i.scdn.co as its base and went
   * asking Spotify for our fonts and stylesheets. Harmless-looking console
   * noise, an app shell handed out under someone else's origin, and a cache
   * full of responses that were never ours to give.
   */
  if (url.origin !== self.location.origin) return;

  // Never cache API calls — always live.
  if (url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/dashboard"))),
  );
});

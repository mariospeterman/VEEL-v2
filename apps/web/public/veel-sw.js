self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("wevid-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => offlineDocumentFor(request)));
    return;
  }

  if (isCacheableStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        if (!response.ok || response.type !== "basic") return response;
        const copy = response.clone();
        void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        return response;
      }))
    );
  }
});

self.addEventListener("push", (event) => {
  const payload = safeJson(event.data);
  const title = typeof payload.title === "string" ? payload.title : "WeVid";
  const body = typeof payload.body === "string" ? payload.body : "New account notification";
  const actionUrl = safeInternalPath(payload.actionUrl);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: {
        actionUrl
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const actionUrl = safeInternalPath(event.notification.data?.actionUrl);
  const targetUrl = new URL(actionUrl, self.location.origin).toString();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url === targetUrl) {
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});

function safeJson(data) {
  if (!data) return {};

  try {
    return data.json();
  } catch {
    return {};
  }
}

async function offlineDocumentFor(request) {
  const cached = await caches.match(OFFLINE_URL);
  if (!cached) return Response.error();

  const headers = new Headers(cached.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const document = await cached.text();
  const requestUrl = new URL(request.url);
  const retryUrl = escapeHtmlAttribute(requestUrl.pathname + requestUrl.search);

  return new Response(
    document.replace(`href="${OFFLINE_RETRY_PLACEHOLDER}"`, `href="${retryUrl}"`),
    { headers, status: cached.status, statusText: cached.statusText }
  );
}

function escapeHtmlAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeInternalPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/app/notifications";
  }

  return value;
}

const SHELL_CACHE = "wevid-shell-v1";
const OFFLINE_URL = "/offline";
const OFFLINE_RETRY_PLACEHOLDER = "/offline?retry=current";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/Logo-Light-Transparent.png",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/pwa-icon-maskable-512.png"
];
const PUBLIC_ASSETS = new Set(PRECACHE_URLS);

function isCacheableStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/") || PUBLIC_ASSETS.has(pathname);
}

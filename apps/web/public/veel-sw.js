self.addEventListener("push", (event) => {
  const payload = safeJson(event.data);
  const title = typeof payload.title === "string" ? payload.title : "VEEL";
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

function safeInternalPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/notifications";
  }

  return value;
}

"use client";

import { useEffect, useState } from "react";

export function PwaRuntime() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.clientReady = "true";

    function updateConnectionState() {
      setOffline(!navigator.onLine);
    }

    updateConnectionState();
    window.addEventListener("online", updateConnectionState);
    window.addEventListener("offline", updateConnectionState);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/veel-sw.js", { scope: "/" }).catch(() => {
        // The app remains network-usable when registration is unavailable.
      });
    }

    return () => {
      delete document.documentElement.dataset.clientReady;
      window.removeEventListener("online", updateConnectionState);
      window.removeEventListener("offline", updateConnectionState);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="connection-status" role="status">
      You are offline. Saved app assets remain available; private data will reconnect safely.
    </div>
  );
}

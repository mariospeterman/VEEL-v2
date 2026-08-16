"use client";

import { useEffect, useState } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { readPublicWebEnv } from "@/public-env";

const allowedWebVitals = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);

function reportWebVital(metric: Parameters<Parameters<typeof useReportWebVitals>[0]>[0]) {
  if (!allowedWebVitals.has(metric.name)) return;
  const navigationType = metric.navigationType ?? "navigate";
  void fetch(new URL("/v1/telemetry/web-vitals", readPublicWebEnv().NEXT_PUBLIC_API_BASE_URL), {
    body: JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType,
      id: metric.id
    }),
    cache: "no-store",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST"
  }).catch(() => {
    // Telemetry never blocks or changes product behavior.
  });
}

export function PwaRuntime() {
  const [offline, setOffline] = useState(false);
  useReportWebVitals(reportWebVital);

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

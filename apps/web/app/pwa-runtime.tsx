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
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
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
      void navigator.serviceWorker.register("/veel-sw.js", { scope: "/" }).then((registration) => {
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(worker);
            }
          });
        });
      }).catch(() => {
        // The app remains network-usable when registration is unavailable.
      });

    }

    return () => {
      delete document.documentElement.dataset.clientReady;
      window.removeEventListener("online", updateConnectionState);
      window.removeEventListener("offline", updateConnectionState);
    };
  }, []);

  function applyUpdate() {
    if (!waitingWorker) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  if (!offline && !waitingWorker) return null;

  return (
    <div className="connection-status" role="status">
      {offline ? "You are offline. Saved public app assets remain available; private data will reconnect safely." : "A new WeVid version is ready."}
      {waitingWorker ? <button className="ml-3 font-semibold underline" onClick={applyUpdate} type="button">Update WeVid</button> : null}
    </div>
  );
}

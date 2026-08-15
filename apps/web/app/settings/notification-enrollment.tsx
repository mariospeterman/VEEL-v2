"use client";

import { useMemo, useState } from "react";
import type { ApiResult, NotificationPushConfig } from "@/api-client";
import { mapApiFailure } from "@/api-errors";
import {
  registerNotificationDevice,
  type RegisterNotificationDeviceRequest
} from "@/api-mutations";

type EnrollmentState = "idle" | "working" | "registered" | "blocked" | "unsupported" | "unavailable";

export function NotificationEnrollment({
  pushConfig
}: {
  pushConfig: ApiResult<NotificationPushConfig>;
}) {
  const [state, setState] = useState<EnrollmentState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const supported = useMemo(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    []
  );

  if (!pushConfig.ok) {
    return <EnrollmentStatus state="unavailable" message={mapApiFailure(pushConfig, "Browser push").message} />;
  }

  if (!pushConfig.data.enabled || !pushConfig.data.vapidPublicKey) {
    return <EnrollmentStatus state="unavailable" message="Browser push is waiting for VAPID public-key configuration." />;
  }
  const vapidPublicKey = pushConfig.data.vapidPublicKey;

  async function enablePush() {
    if (!supported) {
      setState("unsupported");
      setMessage("This browser does not support installable push notifications.");
      return;
    }

    setState("working");
    setMessage(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("blocked");
        setMessage("Browser permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/veel-sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToArrayBuffer(vapidPublicKey)
      });
      const device = pushSubscriptionToDevice(subscription);

      await registerNotificationDevice(device);

      setState("registered");
      setMessage("Browser push is registered for this device.");
    } catch {
      setState("unavailable");
      setMessage("Browser push enrollment failed.");
    }
  }

  return (
    <div className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Browser push</p>
          <p className="mt-1 text-(--muted)">{message ?? statusMessage(state, supported)}</p>
        </div>
        <button
          className="rounded bg-(--foreground) px-3 py-2 text-sm font-medium text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={state === "working"}
          onClick={enablePush}
          type="button"
        >
          {state === "working" ? "Enabling" : "Enable"}
        </button>
      </div>
    </div>
  );
}

function EnrollmentStatus({ message, state }: { message: string; state: EnrollmentState }) {
  return (
    <div className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <p className="font-medium">Browser push</p>
      <p className="mt-1 text-(--muted)">{stateLabel(state)}</p>
      <p className="mt-1 text-(--muted)">{message}</p>
    </div>
  );
}

function statusMessage(state: EnrollmentState, supported: boolean) {
  if (!supported) return "This browser cannot register push notifications.";
  if (state === "registered") return "Browser push is registered for this device.";
  return "Register this browser for account notifications.";
}

function stateLabel(state: EnrollmentState) {
  return state.replace("_", " ");
}

function pushSubscriptionToDevice(subscription: PushSubscription): RegisterNotificationDeviceRequest {
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");

  if (!p256dh || !auth) {
    throw new Error("Push subscription keys are missing");
  }

  return {
    provider: "web_push",
    platform: platform(),
    endpoint: subscription.endpoint,
    p256dh: arrayBufferToBase64Url(p256dh),
    auth: arrayBufferToBase64Url(auth),
    userAgent: navigator.userAgent
  };
}

function platform(): RegisterNotificationDeviceRequest["platform"] {
  const userAgent = navigator.userAgent.toLowerCase();
  if (/iphone|ipad/.test(userAgent)) return "ios";
  if (userAgent.includes("android")) return "android";
  if (/mobile|phone/.test(userAgent)) return "mobile_web";
  return "desktop";
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new ArrayBuffer(raw.length);
  const view = new Uint8Array(output);

  for (let index = 0; index < raw.length; index += 1) {
    view[index] = raw.charCodeAt(index);
  }

  return output;
}

function arrayBufferToBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let raw = "";

  for (const byte of bytes) {
    raw += String.fromCharCode(byte);
  }

  return window.btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

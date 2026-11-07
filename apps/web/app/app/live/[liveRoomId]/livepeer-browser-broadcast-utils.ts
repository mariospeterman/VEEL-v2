import { getIngest } from "@livepeer/react/external";

const livepeerWhipOrigin = "https://playback.livepeer.studio";
const livepeerStreamKeyPattern = /^[A-Za-z0-9_-]+$/;

export interface BrowserBroadcastCapabilities {
  secureContext: boolean;
  mediaDevices: boolean;
  getUserMedia: boolean;
  peerConnection: boolean;
}

export type BrowserBroadcastSupport =
  | { supported: true }
  | { supported: false; reason: string };

export function evaluateBrowserBroadcastSupport(
  capabilities: BrowserBroadcastCapabilities
): BrowserBroadcastSupport {
  if (!capabilities.secureContext) {
    return {
      supported: false,
      reason: "Camera broadcasting needs a secure HTTPS connection or localhost."
    };
  }
  if (!capabilities.mediaDevices || !capabilities.getUserMedia) {
    return {
      supported: false,
      reason: "This browser cannot provide camera and microphone access."
    };
  }
  if (!capabilities.peerConnection) {
    return {
      supported: false,
      reason: "This browser does not support the WebRTC connection required for live video."
    };
  }
  return { supported: true };
}

export function detectBrowserBroadcastSupport(): BrowserBroadcastSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      supported: false,
      reason: "Camera support can only be checked in a browser."
    };
  }

  return evaluateBrowserBroadcastSupport({
    secureContext: window.isSecureContext,
    mediaDevices: Boolean(navigator.mediaDevices),
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    peerConnection: typeof window.RTCPeerConnection === "function"
  });
}

/**
 * Livepeer's React package re-exports the installed core `getIngest` helper.
 * It converts the host-only stream key into the provider's HTTPS WHIP URL.
 */
export function livepeerWhipIngestUrl(streamKey: string): string | null {
  const normalizedKey = streamKey.trim();
  if (
    normalizedKey.length === 0 ||
    normalizedKey !== streamKey ||
    !livepeerStreamKeyPattern.test(normalizedKey)
  ) {
    return null;
  }

  try {
    const resolvedIngestUrl = getIngest(normalizedKey);
    if (!resolvedIngestUrl) return null;

    const ingestUrl = new URL(resolvedIngestUrl);
    const expectedPath = `/webrtc/${normalizedKey}`;

    if (
      ingestUrl.protocol !== "https:" ||
      ingestUrl.origin !== livepeerWhipOrigin ||
      ingestUrl.username.length > 0 ||
      ingestUrl.password.length > 0 ||
      ingestUrl.pathname !== expectedPath ||
      ingestUrl.search.length > 0 ||
      ingestUrl.hash.length > 0
    ) {
      return null;
    }

    return `${livepeerWhipOrigin}${expectedPath}`;
  } catch {
    return null;
  }
}

/** Stop every local camera/microphone track before the SDK tree is removed. */
export function releaseBroadcastMedia(
  element: { srcObject: unknown } | null
): void {
  if (!element) return;
  releaseMediaSource(element.srcObject);
  element.srcObject = null;
}

/**
 * Stop tracks from a replaced stream while preserving any track reused by the
 * next stream. Device changes otherwise risk leaving the old camera active.
 */
export function releaseMediaSource(source: unknown, preserveSource?: unknown): void {
  const preservedTracks = new Set(mediaTracks(preserveSource));
  for (const track of mediaTracks(source)) {
    if (preservedTracks.has(track)) continue;
    try {
      track.stop?.();
    } catch {
      // Cleanup must continue so one failed track cannot retain another device.
    }
  }
}

export function browserBroadcastErrorMessage(
  type: "offline" | "access-control" | "fallback" | "permissions" | "unknown"
): string {
  if (type === "permissions") {
    return "Camera or microphone access was denied. Allow access in your browser, then close and reopen the preview."
  }
  if (type === "access-control") {
    return "The live connection is no longer authorized. Close the preview and sign in again."
  }
  if (type === "offline") {
    return "The live connection went offline. Check your network, then stop and reopen the preview."
  }
  return "The browser could not start the live connection. Stop the preview and try again."
}

function mediaTracks(source: unknown): Array<{ stop?: () => void }> {
  if (
    !source ||
    typeof source !== "object" ||
    !("getTracks" in source) ||
    typeof source.getTracks !== "function"
  ) {
    return [];
  }
  return source.getTracks() as Array<{ stop?: () => void }>;
}

import { describe, expect, it, vi } from "vitest";
import {
  browserBroadcastErrorMessage,
  evaluateBrowserBroadcastSupport,
  livepeerWhipIngestUrl,
  releaseBroadcastMedia,
  releaseMediaSource
} from "./livepeer-browser-broadcast-utils";

describe("Livepeer browser broadcast helpers", () => {
  it("derives the installed Livepeer WHIP ingest URL without persisting the key", () => {
    expect(livepeerWhipIngestUrl("synthetic-stream-key")).toBe(
      "https://playback.livepeer.studio/webrtc/synthetic-stream-key"
    );
    expect(livepeerWhipIngestUrl("synthetic_stream_key-123")).toBe(
      "https://playback.livepeer.studio/webrtc/synthetic_stream_key-123"
    );
  });

  it.each([
    "",
    "   ",
    " synthetic-stream-key",
    "synthetic-stream-key ",
    "synthetic-stream-key\r\n",
    "https://evil.example/whip",
    "http://playback.livepeer.studio/webrtc/synthetic-stream-key",
    "//evil.example/whip",
    "synthetic-stream-key/extra",
    "synthetic-stream-key?redirect=https://evil.example",
    "synthetic-stream-key#fragment",
    "synthetic-stream-key%2Fextra",
    "synthetic-stream-key\\extra"
  ])("rejects a noncanonical or destination-shaped stream key: %j", (streamKey) => {
    expect(livepeerWhipIngestUrl(streamKey)).toBeNull();
  });

  it("requires a secure context, media capture, and WebRTC", () => {
    expect(evaluateBrowserBroadcastSupport({
      secureContext: true,
      mediaDevices: true,
      getUserMedia: true,
      peerConnection: true
    })).toEqual({ supported: true });

    expect(evaluateBrowserBroadcastSupport({
      secureContext: false,
      mediaDevices: true,
      getUserMedia: true,
      peerConnection: true
    })).toMatchObject({ supported: false, reason: expect.stringContaining("HTTPS") });

    expect(evaluateBrowserBroadcastSupport({
      secureContext: true,
      mediaDevices: false,
      getUserMedia: false,
      peerConnection: true
    })).toMatchObject({ supported: false, reason: expect.stringContaining("camera") });

    expect(evaluateBrowserBroadcastSupport({
      secureContext: true,
      mediaDevices: true,
      getUserMedia: true,
      peerConnection: false
    })).toMatchObject({ supported: false, reason: expect.stringContaining("WebRTC") });
  });

  it("stops every local media track and clears the mounted resource", () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const element: { srcObject: unknown } = {
      srcObject: {
        getTracks: () => [
          { stop: firstStop },
          { stop: () => { throw new Error("synthetic cleanup failure"); } },
          { stop: secondStop }
        ]
      }
    };

    releaseBroadcastMedia(element);

    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).toHaveBeenCalledOnce();
    expect(element.srcObject).toBeNull();
  });

  it("stops replaced device tracks without stopping a track reused by the next stream", () => {
    const replacedStop = vi.fn();
    const preservedStop = vi.fn();
    const preservedTrack = { stop: preservedStop };

    releaseMediaSource(
      { getTracks: () => [{ stop: replacedStop }, preservedTrack] },
      { getTracks: () => [preservedTrack] }
    );

    expect(replacedStop).toHaveBeenCalledOnce();
    expect(preservedStop).not.toHaveBeenCalled();
  });

  it("maps provider errors to credential-safe user guidance", () => {
    expect(browserBroadcastErrorMessage("permissions")).toContain("denied");
    expect(browserBroadcastErrorMessage("offline")).toContain("offline");
    expect(browserBroadcastErrorMessage("unknown")).not.toContain("streamKey");
  });
});

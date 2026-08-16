"use client";

export function OfflineRetryButton() {
  return (
    <button className="primary-button" onClick={() => window.location.reload()} type="button">
      Try again
    </button>
  );
}

import Link from "next/link";
import { OfflineRetryButton } from "./offline-retry-button";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <img alt="" height="72" src="/Logo-Light-Transparent.png" width="72" />
      <p className="offline-eyebrow">Connection needed</p>
      <h1>WeVid is offline</h1>
      <p>
        Private content and account actions are never stored for offline use. Reconnect, then try the page again.
      </p>
      <div className="offline-actions">
        <OfflineRetryButton />
        <Link className="secondary-button" href="/">Go to WeVid</Link>
      </div>
    </main>
  );
}

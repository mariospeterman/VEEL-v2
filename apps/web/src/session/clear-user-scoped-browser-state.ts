import { clearPrivateMessageClientState } from "../messages/offline-message-queue";
import { clearRecentSearchClientState } from "../search/recent-searches";

interface BrowserStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function clearUserScopedBrowserState(
  localStorage: BrowserStorage = window.localStorage,
  sessionStorage: BrowserStorage = window.sessionStorage
): void {
  runBestEffort(() => clearPrivateMessageClientState(localStorage, sessionStorage));
  runBestEffort(() => clearRecentSearchClientState(sessionStorage, localStorage));
}

function runBestEffort(cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    // Server-side logout must not depend on browser storage availability.
  }
}

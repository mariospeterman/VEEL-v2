export function OfflineRetryButton() {
  return (
    <a className="primary-button" data-offline-retry href="/offline?retry=current">
      Try again
    </a>
  );
}

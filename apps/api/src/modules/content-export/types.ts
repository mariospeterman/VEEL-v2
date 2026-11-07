import type { ContentExportProvider } from "../../content-export-provider.js";

export type ContentExportState =
  | "queued"
  | "processing"
  | "retry"
  | "ready"
  | "cancelled"
  | "dead_letter"
  | "expired";

export interface ContentExportResource {
  id: string;
  dataRequestId: string;
  state: ContentExportState;
  progress: {
    totalItems: number;
    completedItems: number;
    availableItems: number;
    unavailableItems: number;
  };
  attemptCount: number;
  lastErrorCode: string | null;
  snapshotCreatedAt: string;
  archiveReadyAt: string | null;
  downloadableUntil: string | null;
  canCancel: boolean;
  canRetry: boolean;
  canDownload: boolean;
}

export interface ContentExportDownloadGrantResource {
  id: string;
  contentExportId: string;
  expiresAt: string;
  downloadUrl: string;
}

export interface AuthorizedContentExportDownload {
  archiveObjectKey: string;
  archiveByteSize: number;
  archiveSha256: string;
  filename: string;
}

export interface ContentExportRepository {
  cancel(input: {
    userId: string;
    jobId: string;
    idempotencyKey: string;
  }): Promise<ContentExportResource | null>;
  retry(input: {
    userId: string;
    jobId: string;
    idempotencyKey: string;
  }): Promise<ContentExportResource | null>;
  createDownloadGrant(input: {
    userId: string;
    jobId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<ContentExportDownloadGrantResource | null>;
  authorizeDownload(input: {
    userId: string;
    jobId: string;
    grantId: string;
    now: Date;
  }): Promise<AuthorizedContentExportDownload | null>;
}

export interface RegisterContentExportRoutesOptions {
  authVerifier: import("../session/types.js").ApplicationSessionVerifier;
  contentExportRepository: ContentExportRepository;
  contentExportProvider: ContentExportProvider;
}

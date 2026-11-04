interface FeedCursorPayload {
  version: 2;
  mode: "recommended" | "following";
  surface: "home" | "bits" | "moments";
  sessionId: string;
  position: number;
}

export class InvalidFeedCursorError extends Error {
  readonly code = "INVALID_FEED_CURSOR";

  constructor() {
    super("INVALID_FEED_CURSOR");
    this.name = "InvalidFeedCursorError";
  }
}

export class StaleFeedCursorError extends Error {
  readonly code = "STALE_FEED_CURSOR";

  constructor() {
    super("STALE_FEED_CURSOR");
    this.name = "StaleFeedCursorError";
  }
}

export function isInvalidFeedCursorError(error: unknown): boolean {
  return error instanceof InvalidFeedCursorError || hasFeedCursorErrorCode(error, "INVALID_FEED_CURSOR");
}

export function isStaleFeedCursorError(error: unknown): boolean {
  return error instanceof StaleFeedCursorError || hasFeedCursorErrorCode(error, "STALE_FEED_CURSOR");
}

export function encodeFeedCursor(payload: Omit<FeedCursorPayload, "version">): string {
  return Buffer.from(JSON.stringify({ version: 2, ...payload } satisfies FeedCursorPayload), "utf8")
    .toString("base64url");
}

export function decodeFeedCursor(cursor: string): FeedCursorPayload {
  if (cursor.length < 1 || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidFeedCursorError();
  }

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<FeedCursorPayload>;
    if (
      value.version !== 2 ||
      !["recommended", "following"].includes(value.mode ?? "") ||
      !["home", "bits", "moments"].includes(value.surface ?? "") ||
      typeof value.sessionId !== "string" ||
      !isUuid(value.sessionId) ||
      !Number.isInteger(value.position) ||
      value.position! < 1 ||
      value.position! > 512
    ) {
      throw new InvalidFeedCursorError();
    }
    return value as FeedCursorPayload;
  } catch (error) {
    if (error instanceof InvalidFeedCursorError) throw error;
    throw new InvalidFeedCursorError();
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasFeedCursorErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

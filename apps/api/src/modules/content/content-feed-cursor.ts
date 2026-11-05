import {
  cursorTimestamp,
  isCanonicalCursorTimestamp
} from "../../shared/database-timestamp.js";

const feedCursorVersion = 3;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface FeedCursorPayload {
  version: typeof feedCursorVersion;
  scope: string;
  upperPublishedAt: string;
  upperId: string;
  afterPublishedAt: string;
  afterId: string;
}

export interface FeedCursorBoundary {
  publishedAt: string;
  id: string;
}

export interface DecodedFeedCursor {
  upper: FeedCursorBoundary;
  after: FeedCursorBoundary;
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

export function encodeFeedCursor(input: {
  scope: string;
  upper: { publishedAt: Date | string; id: string };
  after: { publishedAt: Date | string; id: string };
}): string {
  if (!validScope(input.scope) || !uuidPattern.test(input.upper.id) || !uuidPattern.test(input.after.id)) {
    throw new InvalidFeedCursorError();
  }

  let upperPublishedAt: string;
  let afterPublishedAt: string;
  try {
    upperPublishedAt = cursorTimestamp(input.upper.publishedAt);
    afterPublishedAt = cursorTimestamp(input.after.publishedAt);
  } catch {
    throw new InvalidFeedCursorError();
  }

  return Buffer.from(JSON.stringify({
    version: feedCursorVersion,
    scope: input.scope,
    upperPublishedAt,
    upperId: input.upper.id,
    afterPublishedAt,
    afterId: input.after.id
  } satisfies FeedCursorPayload), "utf8").toString("base64url");
}

export function decodeFeedCursor(cursor: string, expectedScope: string): DecodedFeedCursor {
  if (
    cursor.length < 1 ||
    cursor.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(cursor) ||
    !validScope(expectedScope)
  ) {
    throw new InvalidFeedCursorError();
  }

  let value: Partial<Omit<FeedCursorPayload, "version">> & { version?: number };
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as typeof value;
  } catch {
    throw new InvalidFeedCursorError();
  }

  // Versions 1 and 2 encoded the retired scored feed and its short-lived
  // ranking-session position. Neither can be reinterpreted as a publication
  // timestamp without skipping or duplicating content, so old clients receive
  // the documented refresh response.
  if (value.version === 1 || value.version === 2) throw new StaleFeedCursorError();

  if (
    value.version !== feedCursorVersion ||
    value.scope !== expectedScope ||
    !isCanonicalCursorTimestamp(value.upperPublishedAt) ||
    !isCanonicalCursorTimestamp(value.afterPublishedAt) ||
    typeof value.upperId !== "string" ||
    typeof value.afterId !== "string" ||
    !uuidPattern.test(value.upperId) ||
    !uuidPattern.test(value.afterId)
  ) {
    throw new InvalidFeedCursorError();
  }

  return {
    upper: { publishedAt: value.upperPublishedAt, id: value.upperId },
    after: { publishedAt: value.afterPublishedAt, id: value.afterId }
  };
}

function validScope(value: string): boolean {
  return value.length > 0 && value.length <= 160;
}

function hasFeedCursorErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

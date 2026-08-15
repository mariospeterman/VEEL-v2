interface FeedCursorPayload {
  version: 1;
  mode: "recommended" | "following" | "nsfw" | "sfw";
  surface: "home" | "bits";
  asOf: string;
  score: number;
  createdAt: string;
  id: string;
}

export class InvalidFeedCursorError extends Error {
  constructor() {
    super("INVALID_FEED_CURSOR");
    this.name = "InvalidFeedCursorError";
  }
}

export function encodeFeedCursor(payload: Omit<FeedCursorPayload, "version">): string {
  return Buffer.from(JSON.stringify({ version: 1, ...payload } satisfies FeedCursorPayload), "utf8")
    .toString("base64url");
}

export function decodeFeedCursor(cursor: string): FeedCursorPayload {
  if (cursor.length < 1 || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidFeedCursorError();
  }

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<FeedCursorPayload>;
    if (
      value.version !== 1 ||
      !["recommended", "following", "nsfw", "sfw"].includes(value.mode ?? "") ||
      !["home", "bits"].includes(value.surface ?? "") ||
      !isCanonicalTimestamp(value.asOf) ||
      !isCanonicalTimestamp(value.createdAt) ||
      !Number.isInteger(value.score) ||
      value.score! < -2_147_483_648 ||
      value.score! > 2_147_483_647 ||
      Date.parse(value.createdAt) > Date.parse(value.asOf) ||
      Date.parse(value.asOf) > Date.now() + 5 * 60_000 ||
      typeof value.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
    ) {
      throw new InvalidFeedCursorError();
    }
    return value as FeedCursorPayload;
  } catch (error) {
    if (error instanceof InvalidFeedCursorError) throw error;
    throw new InvalidFeedCursorError();
  }
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

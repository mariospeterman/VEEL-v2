export interface RealtimeInvalidation {
  event: string;
  resourceKind: string;
  resourceId: string;
  version: number;
}

export function parseRealtimeInvalidation(value: unknown): RealtimeInvalidation | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<RealtimeInvalidation>;
  return typeof payload.event === "string" &&
    typeof payload.resourceKind === "string" &&
    typeof payload.resourceId === "string" &&
    Number.isSafeInteger(payload.version) && (payload.version ?? 0) > 0
    ? payload as RealtimeInvalidation
    : null;
}

export function acceptRealtimeVersion(versions: Map<string, number>, topic: string, version: number) {
  if (version <= (versions.get(topic) ?? 0)) return false;
  versions.set(topic, version);
  return true;
}

export function shouldRecoverRealtimeGap(status: string) {
  return status === "SUBSCRIBED";
}

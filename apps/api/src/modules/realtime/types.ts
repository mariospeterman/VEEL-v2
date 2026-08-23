import type { components } from "@veel/contracts";

export interface RealtimeAccessToken {
  token: string;
  expiresAt: string;
  accountTopic: string;
}

export type RealtimeConnectionEventRequest = components["schemas"]["RealtimeConnectionEventRequest"];

export interface RealtimeTokenIssuer {
  issueToken(input: { userId: string }): Promise<RealtimeAccessToken>;
}

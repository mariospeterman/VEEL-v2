export interface RealtimeAccessToken {
  token: string;
  expiresAt: string;
}

export interface RealtimeTokenIssuer {
  issueToken(input: { userId: string }): Promise<RealtimeAccessToken>;
}

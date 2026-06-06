import type { components } from "@veel/contracts";

export type ActivityItem = components["schemas"]["ActivityItem"];
export type ActivityPage = components["schemas"]["ActivityPage"];
export type WalletTransaction = components["schemas"]["WalletTransaction"];
export type WalletTransactionPage = components["schemas"]["WalletTransactionPage"];
export type AccessPassPage = components["schemas"]["AccessPassPage"];

export interface ListActivityInput {
  supabaseUserId: string;
  limit: number;
  cursor?: string;
}

export interface ActivityRepository {
  listActivity(input: ListActivityInput): Promise<ActivityPage>;
  listPaymentActivity(input: ListActivityInput): Promise<ActivityPage>;
  listWalletTransactions(input: ListActivityInput): Promise<WalletTransactionPage>;
  listAccessPasses(input: ListActivityInput): Promise<AccessPassPage>;
  close?(): Promise<void>;
}

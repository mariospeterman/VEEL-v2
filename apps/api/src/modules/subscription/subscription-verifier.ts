import {
  getRecurringDelegationDecoder,
  getSubscriptionAuthorityDecoder
} from "@solana/subscriptions";
import { Connection, PublicKey } from "@solana/web3.js";
import type { ServerEnv } from "@veel/config";
import bs58 from "bs58";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeTokenAccount,
  deriveAssociatedTokenAddress
} from "../solana/token-program.js";
import {
  checkSubscriptionProviderReadiness,
  getSubscriptionProviderConfig,
  isSupportedSubscriptionMint
} from "./subscription-provider-config.js";
import type {
  SubscriptionAuthorizationVerifier,
  SubscriptionAuthorizationVerificationResult,
  VerifySubscriptionAuthorizationInput
} from "./types.js";

const memoProgramId = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const defaultRpcDeadlineMs = 10_000;

export interface SolanaSubscriptionAuthorizationVerifierOptions {
  rpcDeadlineMs?: number;
}

export function createSolanaSubscriptionAuthorizationVerifier(
  env?: ServerEnv,
  options: SolanaSubscriptionAuthorizationVerifierOptions = {}
): SubscriptionAuthorizationVerifier {
  const config = env ? getSubscriptionProviderConfig(env) : null;
  const readiness = env ? checkSubscriptionProviderReadiness(env) : null;
  const rpcDeadlineMs = options.rpcDeadlineMs ?? defaultRpcDeadlineMs;

  return {
    async verifyAuthorization(input) {
      const localFailure = validateLocalFacts(input, config, readiness);
      if (localFailure) return localFailure;
      const rpcUrl = config?.rpcUrl;
      if (!rpcUrl || !input.tokenMint || !input.collectorAddress || !input.subscriberWallet) {
        return failed("provider_not_configured");
      }

      try {
        return await withRpcDeadline(verifyOnchainAuthorization({
          input,
          rpcUrl
        }), rpcDeadlineMs);
      } catch {
        return failed("rpc_unavailable", { retryable: true });
      }
    }
  };
}

async function verifyOnchainAuthorization(input: {
  input: VerifySubscriptionAuthorizationInput;
  rpcUrl: string;
}): Promise<SubscriptionAuthorizationVerificationResult> {
  const { input: authorization } = input;
  const connection = new Connection(input.rpcUrl, "finalized");
  const statusResponse = await connection.getSignatureStatuses(
    [authorization.signature],
    { searchTransactionHistory: true }
  );
  const statusFailure = classifySubscriptionAuthorizationSignatureStatus(
    statusResponse.value[0] ?? null
  );
  if (statusFailure) return statusFailure;

  const transaction = await connection.getTransaction(authorization.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0
  });
  if (!transaction) return failed("transaction_not_found", { retryable: true });
  if (transaction.meta?.err) return failed("transaction_failed");
  if (!transaction.blockTime || transaction.blockTime * 1000 > authorization.expiresAt.getTime()) {
    return failed("intent_expired");
  }

  const accountKeys = transaction.transaction.message.getAccountKeys().staticAccountKeys;
  const requiredSigner = accountKeys[0]?.toBase58();
  if (requiredSigner !== authorization.subscriberWallet) return failed("subscriber_mismatch");
  const instructions = transaction.transaction.message.compiledInstructions;
  const hasProgram = instructions.some(
    (instruction) =>
      accountKeys[instruction.programIdIndex]?.toBase58() === authorization.delegationProgramId
  );
  if (!hasProgram) return failed("missing_authorization_evidence");
  const expectedMemo = `wevid:subscription-auth:${authorization.setupReference}`;
  const hasMemo = instructions.some((instruction) => {
    if (accountKeys[instruction.programIdIndex]?.toBase58() !== memoProgramId) return false;
    return Buffer.from(instruction.data).toString("utf8") === expectedMemo;
  });
  if (!hasMemo) return failed("missing_authorization_evidence");

  const programKey = new PublicKey(authorization.delegationProgramId);
  const [authorityInfo, delegationInfo] = await Promise.all([
    connection.getAccountInfo(new PublicKey(authorization.authorityAddress), "finalized"),
    connection.getAccountInfo(new PublicKey(authorization.delegationAddress), "finalized")
  ]);
  if (!authorityInfo) return failed("authority_not_found");
  if (!delegationInfo) return failed("delegation_not_found");
  if (!authorityInfo.owner.equals(programKey) || !delegationInfo.owner.equals(programKey)) {
    return failed("program_id_mismatch");
  }

  const authority = getSubscriptionAuthorityDecoder().decode(authorityInfo.data);
  const delegation = getRecurringDelegationDecoder().decode(delegationInfo.data);
  if (
    authority.user !== authorization.subscriberWallet ||
    delegation.header.delegator !== authorization.subscriberWallet
  ) {
    return failed("subscriber_mismatch");
  }
  if (authority.tokenMint !== authorization.tokenMint || delegation.mint !== authorization.tokenMint) {
    return failed("mint_mismatch");
  }
  if (delegation.subscriptionAuthority !== authorization.authorityAddress) return failed("authority_not_found");
  if (delegation.header.delegatee !== authorization.collectorAddress) return failed("collector_mismatch");
  if (delegation.amountPerPeriod !== BigInt(authorization.amountAtomic)) return failed("amount_mismatch");
  if (delegation.periodLengthS !== BigInt(authorization.periodSeconds)) return failed("period_mismatch");
  const delegationExpiry = Number(delegation.expiryTs) * 1000;
  if (
    delegationExpiry <= Date.now() ||
    Math.abs(delegationExpiry - authorization.delegationExpiresAt.getTime()) > 1_000
  ) {
    return failed("expired");
  }

  const tokenProgram = authorization.tokenProgram === "token_2022"
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  const expectedAta = deriveAssociatedTokenAddress(
    new PublicKey(authorization.tokenMint),
    new PublicKey(authorization.subscriberWallet),
    tokenProgram
  );
  if (expectedAta.toBase58() !== authorization.subscriberTokenAccount) return failed("subscriber_mismatch");
  const tokenAccountInfo = await connection.getAccountInfo(expectedAta, "finalized");
  if (!tokenAccountInfo || !tokenAccountInfo.owner.equals(tokenProgram)) return failed("subscriber_mismatch");
  const tokenAccount = decodeTokenAccount(tokenAccountInfo.data);
  if (
    tokenAccount.owner !== authorization.subscriberWallet ||
    tokenAccount.mint !== authorization.tokenMint
  ) {
    return failed("subscriber_mismatch");
  }

  return {
    verified: true,
    retryable: false,
    facts: {
      subscriberWallet: authorization.subscriberWallet,
      subscriberTokenAccount: authorization.subscriberTokenAccount,
      tokenMint: authorization.tokenMint,
      authorityAddress: authorization.authorityAddress,
      delegationAddress: authorization.delegationAddress,
      subscriptionPda: authorization.delegationAddress,
      planPda: null,
      programId: authorization.delegationProgramId,
      merchantWallet: authorization.merchantWallet,
      collectorWallet: authorization.collectorAddress,
      amountMinor: authorization.amountMinor,
      periodDays: authorization.periodDays,
      delegationExpiresAt: authorization.delegationExpiresAt.toISOString(),
      verifiedAt: new Date().toISOString()
    }
  };
}

export function classifySubscriptionAuthorizationSignatureStatus(
  status: {
    confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
    err: unknown;
  } | null
): SubscriptionAuthorizationVerificationResult | null {
  if (!status) return failed("transaction_not_found", { retryable: true });
  if (status.confirmationStatus !== "finalized") {
    return failed("transaction_pending", { retryable: true });
  }
  if (status.err) return failed("transaction_failed");
  return null;
}

function withRpcDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SUBSCRIPTION_AUTHORIZATION_RPC_DEADLINE")), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function validateLocalFacts(
  input: VerifySubscriptionAuthorizationInput,
  config: ReturnType<typeof getSubscriptionProviderConfig> | null,
  readiness: ReturnType<typeof checkSubscriptionProviderReadiness> | null
): SubscriptionAuthorizationVerificationResult | null {
  if (!input.signature || !input.setupReference || !input.authorityAddress || !input.delegationAddress || !input.subscriberTokenAccount) {
    return failed("missing_authorization_evidence");
  }
  try {
    if (bs58.decode(input.signature).length !== 64) return failed("missing_authorization_evidence");
  } catch {
    return failed("missing_authorization_evidence");
  }
  if (
    input.expiresAt.getTime() <= Date.now() &&
    (!input.acceptedAt || input.acceptedAt.getTime() > input.expiresAt.getTime())
  ) {
    return failed("intent_expired");
  }
  if (!config || readiness?.ok !== true) {
    const reason = readiness?.ok === false ? readiness.reason : "provider_not_configured";
    return failed(reason === "rpc_unavailable" ? "rpc_unavailable" : "provider_not_configured", {
      retryable: reason === "rpc_unavailable" || reason === "provider_not_configured"
    });
  }
  if (input.provider !== "official_solana_subscription_program") return failed("provider_not_configured");
  if (input.tokenMint === "SOL" || input.tokenProgram === null) return failed("unsupported_native_sol_subscription");
  if (!isSupportedSubscriptionMint(config, input.tokenMint)) return failed("unsupported_asset");
  if (input.delegationProgramId !== config.programId) return failed("program_id_mismatch");
  if (input.collectorAddress !== config.collectorWallet) return failed("collector_mismatch");
  if (input.planId.startsWith("platform_") && input.merchantWallet !== config.merchantWallet) {
    return failed("merchant_mismatch");
  }
  for (const value of [
    input.authorityAddress,
    input.delegationAddress,
    input.subscriberTokenAccount,
    input.subscriberWallet
  ]) {
    try {
      new PublicKey(value ?? "");
    } catch {
      return failed("subscriber_mismatch");
    }
  }
  return null;
}

function failed(
  failureCode: NonNullable<SubscriptionAuthorizationVerificationResult["failureCode"]>,
  options: { retryable?: boolean } = {}
): SubscriptionAuthorizationVerificationResult {
  return { verified: false, failureCode, retryable: options.retryable ?? false };
}

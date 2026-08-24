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

export function createSolanaSubscriptionAuthorizationVerifier(
  env?: ServerEnv
): SubscriptionAuthorizationVerifier {
  const config = env ? getSubscriptionProviderConfig(env) : null;
  const readiness = env ? checkSubscriptionProviderReadiness(env) : null;

  return {
    async verifyAuthorization(input) {
      const localFailure = validateLocalFacts(input, config, readiness);
      if (localFailure) return localFailure;
      const rpcUrl = config?.rpcUrl;
      if (!rpcUrl || !input.tokenMint || !input.collectorAddress || !input.subscriberWallet) {
        return failed("provider_not_configured");
      }

      try {
        const connection = new Connection(rpcUrl, "finalized");
        const transaction = await connection.getTransaction(input.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0
        });
        if (!transaction || transaction.meta?.err) return failed("transaction_failed");
        if (!transaction.blockTime || transaction.blockTime * 1000 > input.expiresAt.getTime()) {
          return failed("intent_expired");
        }

        const accountKeys = transaction.transaction.message.getAccountKeys().staticAccountKeys;
        const requiredSigner = accountKeys[0]?.toBase58();
        if (requiredSigner !== input.subscriberWallet) return failed("subscriber_mismatch");
        const instructions = transaction.transaction.message.compiledInstructions;
        const hasProgram = instructions.some(
          (instruction) => accountKeys[instruction.programIdIndex]?.toBase58() === input.delegationProgramId
        );
        if (!hasProgram) return failed("missing_authorization_evidence");
        const expectedMemo = `wevid:subscription-auth:${input.setupReference}`;
        const hasMemo = instructions.some((instruction) => {
          if (accountKeys[instruction.programIdIndex]?.toBase58() !== memoProgramId) return false;
          return Buffer.from(instruction.data).toString("utf8") === expectedMemo;
        });
        if (!hasMemo) return failed("missing_authorization_evidence");

        const programKey = new PublicKey(input.delegationProgramId);
        const [authorityInfo, delegationInfo] = await Promise.all([
          connection.getAccountInfo(new PublicKey(input.authorityAddress), "finalized"),
          connection.getAccountInfo(new PublicKey(input.delegationAddress), "finalized")
        ]);
        if (!authorityInfo) return failed("authority_not_found");
        if (!delegationInfo) return failed("delegation_not_found");
        if (!authorityInfo.owner.equals(programKey) || !delegationInfo.owner.equals(programKey)) {
          return failed("program_id_mismatch");
        }

        const authority = getSubscriptionAuthorityDecoder().decode(authorityInfo.data);
        const delegation = getRecurringDelegationDecoder().decode(delegationInfo.data);
        if (authority.user !== input.subscriberWallet || delegation.header.delegator !== input.subscriberWallet) {
          return failed("subscriber_mismatch");
        }
        if (authority.tokenMint !== input.tokenMint || delegation.mint !== input.tokenMint) {
          return failed("mint_mismatch");
        }
        if (delegation.subscriptionAuthority !== input.authorityAddress) return failed("authority_not_found");
        if (delegation.header.delegatee !== input.collectorAddress) return failed("collector_mismatch");
        if (delegation.amountPerPeriod !== BigInt(input.amountAtomic)) return failed("amount_mismatch");
        if (delegation.periodLengthS !== BigInt(input.periodSeconds)) return failed("period_mismatch");
        const delegationExpiry = Number(delegation.expiryTs) * 1000;
        if (
          delegationExpiry <= Date.now() ||
          Math.abs(delegationExpiry - input.delegationExpiresAt.getTime()) > 1_000
        ) {
          return failed("expired");
        }

        const tokenProgram = input.tokenProgram === "token_2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        const expectedAta = deriveAssociatedTokenAddress(
          new PublicKey(input.tokenMint),
          new PublicKey(input.subscriberWallet),
          tokenProgram
        );
        if (expectedAta.toBase58() !== input.subscriberTokenAccount) return failed("subscriber_mismatch");
        const tokenAccountInfo = await connection.getAccountInfo(expectedAta, "finalized");
        if (!tokenAccountInfo || !tokenAccountInfo.owner.equals(tokenProgram)) return failed("subscriber_mismatch");
        const tokenAccount = decodeTokenAccount(tokenAccountInfo.data);
        if (
          tokenAccount.owner !== input.subscriberWallet ||
          tokenAccount.mint !== input.tokenMint
        ) {
          return failed("subscriber_mismatch");
        }

        return {
          verified: true,
          retryable: false,
          facts: {
            subscriberWallet: input.subscriberWallet,
            subscriberTokenAccount: input.subscriberTokenAccount,
            tokenMint: input.tokenMint,
            authorityAddress: input.authorityAddress,
            delegationAddress: input.delegationAddress,
            subscriptionPda: input.delegationAddress,
            planPda: null,
            programId: input.delegationProgramId,
            merchantWallet: input.merchantWallet,
            collectorWallet: input.collectorAddress,
            amountMinor: input.amountMinor,
            periodDays: input.periodDays,
            delegationExpiresAt: input.delegationExpiresAt.toISOString(),
            verifiedAt: new Date().toISOString()
          }
        };
      } catch {
        return failed("rpc_unavailable", { retryable: true });
      }
    }
  };
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
  if (input.expiresAt.getTime() <= Date.now()) return failed("intent_expired");
  if (!config || readiness?.ok !== true) {
    const reason = readiness?.ok === false ? readiness.reason : "provider_not_configured";
    return failed(reason === "rpc_unavailable" ? "rpc_unavailable" : "provider_not_configured", {
      retryable: reason === "rpc_unavailable"
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

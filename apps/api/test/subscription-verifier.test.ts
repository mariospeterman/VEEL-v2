import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@veel/config";
import {
  classifySubscriptionAuthorizationSignatureStatus,
  createSolanaSubscriptionAuthorizationVerifier,
  validateSubscriptionAccountLinkage
} from "../src/modules/subscription/subscription-verifier";

const programId = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const wallet = "11111111111111111111111111111111";
const mint = "So11111111111111111111111111111111111111112";

describe("createSolanaSubscriptionAuthorizationVerifier", () => {
  it("fails closed when the official provider is not configured", async () => {
    const verifier = createSolanaSubscriptionAuthorizationVerifier();

    await expect(verifier.verifyAuthorization(validInput())).resolves.toMatchObject({
      verified: false,
      failureCode: "provider_not_configured"
    });
  });

  it("rejects native SOL recurring subscriptions", async () => {
    const verifier = createSolanaSubscriptionAuthorizationVerifier(configuredEnv());

    await expect(
      verifier.verifyAuthorization(
        validInput({
          tokenMint: "SOL",
          tokenProgram: null
        })
      )
    ).resolves.toMatchObject({
      verified: false,
      failureCode: "unsupported_native_sol_subscription"
    });
  });

  it("checks configured program, mint, merchant, collector, and subscriber facts", async () => {
    const verifier = createSolanaSubscriptionAuthorizationVerifier(configuredEnv());

    await expect(verifier.verifyAuthorization(validInput({ delegationProgramId: wallet }))).resolves.toMatchObject({
      verified: false,
      failureCode: "program_id_mismatch"
    });

    await expect(verifier.verifyAuthorization(validInput({ tokenMint: wallet }))).resolves.toMatchObject({
      verified: false,
      failureCode: "unsupported_asset"
    });

    await expect(verifier.verifyAuthorization(validInput({ collectorAddress: programId }))).resolves.toMatchObject({
      verified: false,
      failureCode: "collector_mismatch"
    });

    await expect(verifier.verifyAuthorization(validInput({ merchantWallet: programId }))).resolves.toMatchObject({
      verified: false,
      failureCode: "merchant_mismatch"
    });
  });

  it("rejects expired authorization intents before provider verification", async () => {
    const verifier = createSolanaSubscriptionAuthorizationVerifier(configuredEnv());

    await expect(
      verifier.verifyAuthorization(validInput({ expiresAt: new Date("2026-01-01T00:00:00.000Z") }))
    ).resolves.toMatchObject({
      verified: false,
      failureCode: "intent_expired"
    });
  });

  it("lets a previously accepted exact signature outlive the short intent window", async () => {
    const verifier = createSolanaSubscriptionAuthorizationVerifier();

    await expect(verifier.verifyAuthorization(validInput({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      acceptedAt: new Date("2025-12-31T23:59:59.000Z")
    }))).resolves.toMatchObject({
      verified: false,
      failureCode: "provider_not_configured",
      retryable: true
    });
  });
});

describe("classifySubscriptionAuthorizationSignatureStatus", () => {
  it("keeps not-found and not-yet-finalized observations retryable", () => {
    expect(classifySubscriptionAuthorizationSignatureStatus(null)).toEqual({
      verified: false,
      failureCode: "transaction_not_found",
      retryable: true
    });
    expect(classifySubscriptionAuthorizationSignatureStatus({
      confirmationStatus: "confirmed",
      err: { InstructionError: [0, "Custom"] }
    })).toEqual({
      verified: false,
      failureCode: "transaction_pending",
      retryable: true
    });
  });

  it("distinguishes a finalized chain failure from a finalized success", () => {
    expect(classifySubscriptionAuthorizationSignatureStatus({
      confirmationStatus: "finalized",
      err: { InstructionError: [0, "Custom"] }
    })).toEqual({
      verified: false,
      failureCode: "transaction_failed",
      retryable: false
    });
    expect(classifySubscriptionAuthorizationSignatureStatus({
      confirmationStatus: "finalized",
      err: null
    })).toBeNull();
  });
});

describe("validateSubscriptionAccountLinkage", () => {
  const linked = {
    authority: { user: wallet, tokenMint: mint, initId: 7n },
    delegation: {
      delegator: wallet,
      delegatee: wallet,
      initId: 7n,
      subscriptionAuthority: programId,
      mint
    },
    tokenAccount: {
      owner: wallet,
      mint,
      delegate: programId,
      delegatedAmount: 15_000_000n,
      initialized: true
    },
    expected: {
      subscriberWallet: wallet,
      collectorAddress: wallet,
      tokenMint: mint,
      authorityAddress: programId,
      amountAtomic: 15_000_000n
    }
  };

  it("accepts one exact authority/delegation/token linkage", () => {
    expect(validateSubscriptionAccountLinkage(linked)).toBeNull();
  });

  it("rejects mismatched init IDs and insufficient delegated allowance", () => {
    expect(validateSubscriptionAccountLinkage({
      ...linked,
      authority: { ...linked.authority, initId: 8n }
    })).toBe("authority_init_mismatch");
    expect(validateSubscriptionAccountLinkage({
      ...linked,
      tokenAccount: { ...linked.tokenAccount, delegatedAmount: 14_999_999n }
    })).toBe("delegated_allowance_mismatch");
  });
});

function configuredEnv() {
  return parseServerEnv({
    NODE_ENV: "test",
    SUBSCRIPTIONS_ENABLED: "true",
    SUBSCRIPTIONS_PROVIDER: "official_solana_subscription_program",
    SUBSCRIPTIONS_SOLANA_PROGRAM_ID: programId,
    SUBSCRIPTIONS_SOLANA_RPC_URL: "https://api.devnet.solana.com",
    SUBSCRIPTIONS_SUPPORTED_MINTS: mint,
    SUBSCRIPTIONS_DEFAULT_MINT: mint,
    SUBSCRIPTIONS_COLLECTOR_WALLET: wallet,
    SUBSCRIPTIONS_MERCHANT_WALLET: wallet,
    SUBSCRIPTIONS_REQUIRE_ONCHAIN_VERIFICATION: "true"
  });
}

function validInput(overrides = {}) {
  return {
    signature: "1".repeat(64),
    setupReference: "00000000-0000-4000-8000-000000000072",
    authorityAddress: wallet,
    delegationAddress: wallet,
    subscriberTokenAccount: wallet,
    delegationProgramId: programId,
    collectorAddress: wallet,
    subscriberWallet: wallet,
    tokenMint: mint,
    tokenProgram: "spl_token" as const,
    amountMinor: 15_000_000,
    amountAtomic: "15000000",
    periodDays: 30,
    periodSeconds: 2_592_000,
    delegationNonce: 1,
    delegationExpiresAt: new Date("2027-12-01T00:00:00.000Z"),
    provider: "official_solana_subscription_program",
    planId: "platform_plus_monthly",
    planPda: wallet,
    subscriptionPda: wallet,
    merchantWallet: wallet,
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    ...overrides
  };
}

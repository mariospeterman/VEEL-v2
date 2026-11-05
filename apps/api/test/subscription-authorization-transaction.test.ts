import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "../src/modules/solana/token-program";
import { createSubscriptionAuthorizationTransaction } from "../src/modules/subscription/subscription-authorization-transaction.js";
import type { SubscriptionAuthorizationVerificationContext } from "../src/modules/subscription/types.js";

const programId = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const memoProgramId = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

describe("createSubscriptionAuthorizationTransaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("derives the recurring authority facts and binds the unsigned transaction to the backend intent", async () => {
    vi.spyOn(Connection.prototype, "getAccountInfo").mockResolvedValue(null);
    vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100
    });
    const subscriber = Keypair.generate().publicKey.toBase58();
    const collector = Keypair.generate().publicKey.toBase58();
    const mint = Keypair.generate().publicKey.toBase58();
    const context: SubscriptionAuthorizationVerificationContext = {
      authorizationIntentId: "00000000-0000-4000-8000-000000000071",
      setupReference: "00000000-0000-4000-8000-000000000072",
      submittedSignature: null,
      submittedAt: null,
      delegationProgramId: programId,
      collectorAddress: collector,
      subscriberWallet: subscriber,
      authorityAddress: null,
      delegationAddress: null,
      subscriberTokenAccount: null,
      tokenMint: mint,
      tokenProgram: "spl_token",
      amountMinor: 1000,
      amountAtomic: "10000000",
      periodDays: 30,
      periodSeconds: 2_592_000,
      delegationNonce: 0,
      delegationExpiresAt: new Date("2027-11-05T12:00:00.000Z"),
      provider: "official_solana_subscription_program",
      planId: "creator_test_monthly",
      planPda: null,
      subscriptionPda: null,
      merchantWallet: collector,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    };

    const result = await createSubscriptionAuthorizationTransaction({
      context,
      rpcUrl: "https://api.devnet.solana.com"
    });
    const transaction = Transaction.from(Buffer.from(result.transaction, "base64"));
    const programIds = transaction.instructions.map((instruction) => instruction.programId.toBase58());

    expect(programIds).toContain(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    expect(programIds).toContain(programId);
    expect(programIds).toContain(memoProgramId);
    expect(result.authorityAddress).not.toBe(result.delegationAddress);
    expect(() => new PublicKey(result.subscriberTokenAccount)).not.toThrow();
    expect(transaction.instructions.find((instruction) => instruction.programId.toBase58() === memoProgramId)?.data.toString())
      .toBe(`wevid:subscription-auth:${context.setupReference}`);
    expect(transaction.signatures).toHaveLength(1);
    expect(transaction.signatures[0]?.publicKey.toBase58()).toBe(subscriber);
  });

  it("keeps persisted delegation terms stable while refreshing only the recent blockhash", async () => {
    vi.spyOn(Connection.prototype, "getAccountInfo").mockResolvedValue(null);
    vi.spyOn(Connection.prototype, "getLatestBlockhash")
      .mockResolvedValueOnce({
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 100
      })
      .mockResolvedValueOnce({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 200
      });
    const context: SubscriptionAuthorizationVerificationContext = {
      authorizationIntentId: "00000000-0000-4000-8000-000000000081",
      setupReference: "00000000-0000-4000-8000-000000000082",
      submittedSignature: null,
      submittedAt: null,
      delegationProgramId: programId,
      collectorAddress: Keypair.generate().publicKey.toBase58(),
      subscriberWallet: Keypair.generate().publicKey.toBase58(),
      authorityAddress: null,
      delegationAddress: null,
      subscriberTokenAccount: null,
      tokenMint: Keypair.generate().publicKey.toBase58(),
      tokenProgram: "spl_token",
      amountMinor: 1250,
      amountAtomic: "12500000",
      periodDays: 30,
      periodSeconds: 2_592_000,
      delegationNonce: 41,
      delegationExpiresAt: new Date("2027-11-05T12:00:00.000Z"),
      provider: "official_solana_subscription_program",
      planId: "creator_stable_monthly",
      planPda: null,
      subscriptionPda: null,
      merchantWallet: Keypair.generate().publicKey.toBase58(),
      expiresAt: new Date("2026-11-05T12:15:00.000Z")
    };

    const first = await createSubscriptionAuthorizationTransaction({
      context,
      rpcUrl: "https://api.devnet.solana.com"
    });
    const second = await createSubscriptionAuthorizationTransaction({
      context,
      rpcUrl: "https://api.devnet.solana.com"
    });

    expect(second.authorityAddress).toBe(first.authorityAddress);
    expect(second.delegationAddress).toBe(first.delegationAddress);
    expect(second.subscriberTokenAccount).toBe(first.subscriberTokenAccount);
    expect(second.delegationExpiresAt).toBe(first.delegationExpiresAt);
    expect(second.transaction).not.toBe(first.transaction);
  });
});

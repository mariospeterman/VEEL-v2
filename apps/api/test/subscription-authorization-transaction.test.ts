import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      delegationProgramId: programId,
      collectorAddress: collector,
      subscriberWallet: subscriber,
      authorityAddress: null,
      delegationAddress: null,
      subscriberTokenAccount: null,
      tokenMint: mint,
      tokenProgram: "spl_token",
      amountMinor: 1000,
      amountAtomic: 10_000_000,
      periodDays: 30,
      periodSeconds: 2_592_000,
      delegationNonce: 0,
      delegationExpiresAt: null,
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
});

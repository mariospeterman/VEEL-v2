import {
  address,
  createNoopSigner,
  type Instruction as KitInstruction
} from "@solana/kit";
import {
  UNKNOWN_INIT_ID,
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  getCreateRecurringDelegationOverlayInstructionAsync,
  getInitSubscriptionAuthorityOverlayInstructionAsync,
  getSubscriptionAuthorityDecoder
} from "@solana/subscriptions";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";
import type {
  SubscriptionAuthorizationTransaction,
  SubscriptionAuthorizationVerificationContext
} from "./types.js";

const memoProgramId = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const delegationLifetimeSeconds = 366 * 24 * 60 * 60;

export type SubscriptionAuthorizationTransactionBuilder = (
  input: Parameters<typeof createSubscriptionAuthorizationTransaction>[0]
) => Promise<SubscriptionAuthorizationTransaction>;

export async function createSubscriptionAuthorizationTransaction(input: {
  context: SubscriptionAuthorizationVerificationContext;
  rpcUrl: string;
}): Promise<SubscriptionAuthorizationTransaction> {
  const { context } = input;
  if (
    !context.subscriberWallet ||
    !context.collectorAddress ||
    !context.tokenMint ||
    !context.tokenProgram
  ) {
    throw new Error("subscription_transaction_facts_missing");
  }

  const connection = new Connection(input.rpcUrl, "confirmed");
  const ownerKey = new PublicKey(context.subscriberWallet);
  const mintKey = new PublicKey(context.tokenMint);
  const collectorKey = new PublicKey(context.collectorAddress);
  const programAddress = address(context.delegationProgramId);
  const owner = createNoopSigner(address(context.subscriberWallet));
  const tokenProgramKey = context.tokenProgram === "token_2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const userAta = getAssociatedTokenAddressSync(
    mintKey,
    ownerKey,
    false,
    tokenProgramKey,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [authorityAddress] = await findSubscriptionAuthorityPda(
    { user: owner.address, tokenMint: address(context.tokenMint) },
    { programAddress }
  );
  const authorityAccount = await connection.getAccountInfo(new PublicKey(authorityAddress), "confirmed");
  let expectedAuthorityInitId: bigint | number = UNKNOWN_INIT_ID;
  if (authorityAccount) {
    if (!authorityAccount.owner.equals(new PublicKey(context.delegationProgramId))) {
      throw new Error("subscription_authority_owner_mismatch");
    }
    expectedAuthorityInitId = getSubscriptionAuthorityDecoder().decode(authorityAccount.data).initId;
  }

  const [delegationAddress] = await findRecurringDelegationPda(
    {
      subscriptionAuthority: authorityAddress,
      delegator: owner.address,
      delegatee: address(context.collectorAddress),
      nonce: context.delegationNonce
    },
    { programAddress }
  );
  const delegationExpiresAt = new Date(Date.now() + delegationLifetimeSeconds * 1000);
  const transaction = new Transaction();
  transaction.feePayer = ownerKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      ownerKey,
      userAta,
      ownerKey,
      mintKey,
      tokenProgramKey,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );

  if (!authorityAccount) {
    transaction.add(
      toLegacyInstruction(
        await getInitSubscriptionAuthorityOverlayInstructionAsync({
          owner,
          payer: owner,
          tokenMint: address(context.tokenMint),
          tokenProgram: address(tokenProgramKey.toBase58()),
          userAta: address(userAta.toBase58()),
          programAddress
        })
      )
    );
  }

  transaction.add(
    toLegacyInstruction(
      await getCreateRecurringDelegationOverlayInstructionAsync({
        amountPerPeriod: BigInt(context.amountAtomic),
        delegatee: address(collectorKey.toBase58()),
        delegator: owner,
        expectedSubscriptionAuthorityInitId: expectedAuthorityInitId,
        expiryTs: BigInt(Math.floor(delegationExpiresAt.getTime() / 1000)),
        nonce: BigInt(context.delegationNonce),
        payer: owner,
        periodLengthS: BigInt(context.periodSeconds),
        startTs: 0n,
        tokenMint: address(context.tokenMint),
        programAddress
      })
    ),
    new TransactionInstruction({
      keys: [],
      programId: memoProgramId,
      data: Buffer.from(`wevid:subscription-auth:${context.setupReference}`, "utf8")
    })
  );

  return {
    transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    authorityAddress,
    delegationAddress,
    subscriberTokenAccount: userAta.toBase58(),
    delegationExpiresAt: delegationExpiresAt.toISOString()
  };
}

function toLegacyInstruction(instruction: KitInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((account) => {
      const role = Number(account.role);
      return {
        pubkey: new PublicKey(account.address),
        isSigner: role === 2 || role === 3,
        isWritable: role === 1 || role === 3
      };
    }),
    data: Buffer.from(instruction.data ?? new Uint8Array())
  });
}

import {
  Connection,
  type Commitment,
  Keypair,
  PublicKey,
  type ParsedInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type PartiallyDecodedInstruction
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import type {
  PaymentSettlementInput,
  PaymentSettlementResult,
  PaymentSettlementVerifier,
  StoredPaymentIntent
} from "./types.js";

export class SolanaPaymentConfigurationError extends Error {
  constructor() {
    super("SOLANA_PAYMENT_NOT_CONFIGURED");
    this.name = "SolanaPaymentConfigurationError";
  }
}

export function createSolanaReferenceAddress(): string {
  return Keypair.generate().publicKey.toBase58();
}

export function createPaymentCheckoutToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPaymentCheckoutToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function buildCreatorSplitTransaction(input: {
  connection: Pick<Connection, "getLatestBlockhash">;
  intent: StoredPaymentIntent;
  buyerWallet: string;
}): Promise<string> {
  if (input.intent.settlementKind !== "creator_split") {
    throw new SolanaPaymentConfigurationError();
  }

  const buyer = new PublicKey(input.buyerWallet);
  const reference = new PublicKey(input.intent.referenceAddress);
  const transaction = new Transaction();
  transaction.feePayer = buyer;
  transaction.recentBlockhash = (await input.connection.getLatestBlockhash("confirmed")).blockhash;

  if (input.intent.currency === "USDC") {
    addSplTokenSplitInstructions(transaction, input.intent, buyer, reference);
  } else {
    addNativeSolSplitInstructions(transaction, input.intent, buyer, reference);
  }

  transaction.add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: reference, isSigner: false, isWritable: false }],
      data: Buffer.from(paymentMemo(input.intent.id), "utf8")
    })
  );

  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

export function createSolanaRpcSettlementVerifier(
  rpcUrl: string,
  commitment: Extract<Commitment, "confirmed" | "finalized"> = "finalized"
): PaymentSettlementVerifier {
  const connection = new Connection(rpcUrl, commitment);

  return {
    async verifyTransfer(input) {
      return verifySolanaTransfer(connection, input, commitment);
    }
  };
}

export async function verifySolanaTransfer(
  connection: Connection,
  input: PaymentSettlementInput,
  commitment: Extract<Commitment, "confirmed" | "finalized"> = "finalized"
): Promise<PaymentSettlementResult> {
  if (!isValidSignature(input.signature)) {
    return {
      confirmed: false,
      failureCode: "invalid_signature"
    };
  }

  const transaction = await connection.getParsedTransaction(input.signature, {
    commitment,
    maxSupportedTransactionVersion: 0
  });

  if (!transaction) {
    return {
      confirmed: false,
      failureCode: "not_found"
    };
  }

  if (transaction.meta?.err) {
    return {
      confirmed: false,
      failureCode: "transaction_failed"
    };
  }

  if (transaction.blockTime == null) {
    return {
      confirmed: false,
      failureCode: "block_time_missing"
    };
  }

  const blockTime = new Date(transaction.blockTime * 1_000);

  if (blockTime.getTime() > input.expiresAt.getTime()) {
    return {
      confirmed: false,
      failureCode: "intent_expired_before_settlement",
      blockTime
    };
  }

  const accountKeys = transaction.transaction.message.accountKeys.map((key) =>
    key.pubkey.toBase58()
  );

  if (!accountKeys.includes(input.referenceAddress)) {
    return {
      confirmed: false,
      failureCode: "reference_missing"
    };
  }

  const instructions = transaction.transaction.message.instructions;
  const hasExpectedMemo = instructions.some((instruction) => isMatchingMemo(instruction, input.memo));

  if (!hasExpectedMemo) {
    return {
      confirmed: false,
      failureCode: "memo_missing"
    };
  }

  const treasuryWallet = input.treasuryWallet;
  if (
    input.settlementKind === "creator_split" &&
    treasuryWallet &&
    instructions.some((instruction) =>
      isMatchingTransfer(instruction, input, {
        sourceWallet: input.buyerWallet ?? null,
        destinationWallet: treasuryWallet,
        amountMinor: input.totalAmountMinor
      })
    )
  ) {
    return {
      confirmed: false,
      failureCode: "creator_split_paid_treasury"
    };
  }

  const hasCreatorTransfer = instructions.some((instruction) =>
    isMatchingTransfer(instruction, input, {
      sourceWallet: input.buyerWallet ?? null,
      destinationWallet: input.creatorWallet,
      amountMinor: input.creatorAmountMinor
    })
  );
  const hasEnterpriseTransfer =
    input.enterpriseManagementAmountMinor === 0 ||
    hasExpectedEnterpriseTransfer(instructions, input);
  const hasPlatformFeeTransfer =
    input.platformFeeAmountMinor === 0 ||
    instructions.some((instruction) =>
      isMatchingTransfer(instruction, input, {
        sourceWallet: input.buyerWallet ?? null,
        destinationWallet: input.platformFeeWallet,
        amountMinor: input.platformFeeAmountMinor
      })
    );
  const hasReferralTransfer =
    input.referralAmountMinor === 0 ||
    hasExpectedReferralTransfer(instructions, input);

  return hasCreatorTransfer && hasEnterpriseTransfer && hasPlatformFeeTransfer && hasReferralTransfer
    ? {
        confirmed: true,
        blockTime
      }
    : {
        confirmed: false,
        failureCode: "transfer_mismatch"
      };
}

function hasExpectedEnterpriseTransfer(
  instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>,
  input: PaymentSettlementInput
): boolean {
  if (!input.enterpriseWallet) {
    return false;
  }

  return instructions.some((instruction) =>
    isMatchingTransfer(instruction, input, {
      sourceWallet: input.buyerWallet ?? null,
      destinationWallet: input.enterpriseWallet as string,
      amountMinor: input.enterpriseManagementAmountMinor
    })
  );
}

function hasExpectedReferralTransfer(
  instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>,
  input: PaymentSettlementInput
): boolean {
  if (!input.referralWallet) {
    return false;
  }

  const referralWallet = input.referralWallet;
  return instructions.some((instruction) =>
    isMatchingTransfer(instruction, input, {
      sourceWallet: input.buyerWallet ?? null,
      destinationWallet: referralWallet,
      amountMinor: input.referralAmountMinor
    })
  );
}

export function assertSolanaAddress(address: string): void {
  try {
    new PublicKey(address);
  } catch {
    throw new SolanaPaymentConfigurationError();
  }
}

function isMatchingTransfer(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
  settlement: PaymentSettlementInput,
  input: {
    sourceWallet?: string | null;
    destinationWallet: string;
    amountMinor: number;
  }
): boolean {
  if (settlement.currency === "USDC") {
    return isMatchingSplTokenTransfer(instruction, settlement, input);
  }

  return isMatchingNativeSolTransfer(instruction, input);
}

function isMatchingNativeSolTransfer(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
  input: {
    sourceWallet?: string | null;
    destinationWallet: string;
    amountMinor: number;
  }
): boolean {
  if (!("parsed" in instruction)) {
    return false;
  }

  if (instruction.program !== "system" || instruction.parsed?.type !== "transfer") {
    return false;
  }

  const info = instruction.parsed.info as {
    source?: string;
    destination?: string;
    lamports?: number;
  };

  return (
    (!input.sourceWallet || info.source === input.sourceWallet) &&
    info.destination === input.destinationWallet &&
    Number(info.lamports) === input.amountMinor
  );
}

function isMatchingSplTokenTransfer(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
  settlement: PaymentSettlementInput,
  input: {
    sourceWallet?: string | null;
    destinationWallet: string;
    amountMinor: number;
  }
): boolean {
  if (!("parsed" in instruction) || instruction.program !== "spl-token") {
    return false;
  }

  if (instruction.parsed?.type !== "transferChecked" || !settlement.tokenMint) {
    return false;
  }

  const mint = new PublicKey(settlement.tokenMint);
  const destination = getAssociatedTokenAddressSync(mint, new PublicKey(input.destinationWallet));
  const source = input.sourceWallet
    ? getAssociatedTokenAddressSync(mint, new PublicKey(input.sourceWallet))
    : null;
  const info = instruction.parsed.info as {
    authority?: string;
    source?: string;
    destination?: string;
    mint?: string;
    tokenAmount?: { amount?: string; decimals?: number };
  };

  return (
    (!input.sourceWallet || info.authority === input.sourceWallet) &&
    (!source || info.source === source.toBase58()) &&
    info.destination === destination.toBase58() &&
    info.mint === settlement.tokenMint &&
    info.tokenAmount?.amount === BigInt(input.amountMinor).toString() &&
    info.tokenAmount?.decimals === settlement.tokenDecimals
  );
}

function isMatchingMemo(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
  memo: string
): boolean {
  if ("parsed" in instruction) {
    return instruction.program === "spl-memo" && instruction.parsed === memo;
  }

  if (instruction.programId.toBase58() !== MEMO_PROGRAM_ID.toBase58()) {
    return false;
  }

  try {
    return Buffer.from(bs58.decode(instruction.data)).toString("utf8") === memo;
  } catch {
    return false;
  }
}

function isValidSignature(signature: string): boolean {
  try {
    return bs58.decode(signature).length === 64;
  } catch {
    return false;
  }
}

function withReference(instruction: TransactionInstruction, reference: PublicKey): TransactionInstruction {
  instruction.keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  return instruction;
}

function addNativeSolSplitInstructions(
  transaction: Transaction,
  intent: StoredPaymentIntent,
  buyer: PublicKey,
  reference: PublicKey
): void {
  for (const transfer of splitTransfers(intent)) {
    transaction.add(
      withReference(
        SystemProgram.transfer({
          fromPubkey: buyer,
          toPubkey: new PublicKey(transfer.wallet),
          lamports: transfer.amountMinor
        }),
        reference
      )
    );
  }
}

function addSplTokenSplitInstructions(
  transaction: Transaction,
  intent: StoredPaymentIntent,
  buyer: PublicKey,
  reference: PublicKey
): void {
  if (!intent.tokenMint || intent.tokenDecimals == null) {
    throw new SolanaPaymentConfigurationError();
  }

  const mint = new PublicKey(intent.tokenMint);
  const source = getAssociatedTokenAddressSync(mint, buyer);

  for (const transfer of splitTransfers(intent)) {
    const owner = new PublicKey(transfer.wallet);
    const destination = getAssociatedTokenAddressSync(mint, owner);
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(buyer, destination, owner, mint),
      withReference(
        createTransferCheckedInstruction(
          source,
          mint,
          destination,
          buyer,
          BigInt(transfer.amountMinor),
          intent.tokenDecimals,
          [],
          TOKEN_PROGRAM_ID
        ),
        reference
      )
    );
  }
}

function splitTransfers(intent: StoredPaymentIntent): Array<{ wallet: string; amountMinor: number }> {
  const transfers = [{ wallet: intent.creatorWallet, amountMinor: intent.creatorAmountMinor }];

  if (intent.enterpriseWallet && intent.enterpriseManagementAmountMinor > 0) {
    transfers.push({
      wallet: intent.enterpriseWallet,
      amountMinor: intent.enterpriseManagementAmountMinor
    });
  }

  if (intent.platformFeeAmountMinor > 0) {
    transfers.push({ wallet: intent.platformFeeWallet, amountMinor: intent.platformFeeAmountMinor });
  }

  if (intent.referralWallet && intent.referralAmountMinor > 0) {
    transfers.push({ wallet: intent.referralWallet, amountMinor: intent.referralAmountMinor });
  }

  return transfers;
}

export function paymentMemo(intentId: string): string {
  return `veel:${intentId}`;
}

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

import {
  Connection,
  type Commitment,
  type FetchFn,
  Keypair,
  PublicKey,
  type ParsedInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type PartiallyDecodedInstruction
} from "@solana/web3.js";
import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createCheckedTokenTransferInstruction,
  deriveAssociatedTokenAddress
} from "../solana/token-program.js";
import { hasSafeSettlementAmounts } from "./payment-amounts.js";
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
  if (
    input.intent.settlementKind !== "creator_split" ||
    !hasSafeSettlementAmounts(input.intent)
  ) {
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
    async verifyTransfer(input, options) {
      const verificationConnection = options?.signal
        ? createAbortableSolanaConnection(rpcUrl, commitment, options.signal)
        : connection;
      return verifySolanaTransfer(verificationConnection, input, commitment);
    },
    async verifyTransactionExpiry(input, options) {
      const verificationConnection = options?.signal
        ? createAbortableSolanaConnection(rpcUrl, commitment, options.signal)
        : connection;
      return verifySolanaTransactionExpiry(verificationConnection, input);
    }
  };
}

/**
 * Proves that one exact wallet-signed transaction can no longer land. A missing settlement lookup
 * alone is never enough: the recent blockhash must be expired and the signature must still be
 * absent from the provider's recent and historical status indexes. The route then applies its
 * terminal state through the same submitted-signature compare-and-set used by confirmation.
 */
export async function verifySolanaTransactionExpiry(
  connection: Pick<Connection, "getSignatureStatuses" | "isBlockhashValid">,
  input: {
    signature: string;
    signedTransactionBase64: string;
    buyerWallet: string | null;
  }
): Promise<
  | { state: "expired" }
  | { state: "active" | "observed" | "invalid" }
> {
  const transaction = validateSignedPaymentTransaction(input);
  if (!transaction) return { state: "invalid" };

  // `confirmed` uses the current supermajority-voted chain view. A more recent blockhash can be
  // valid there before it is visible from a finalized bank, so finalized would create false
  // expiry proofs for transactions signed near the intent boundary.
  const blockhash = await connection.isBlockhashValid(
    transaction.recentBlockhash,
    { commitment: "confirmed" }
  );
  if (blockhash.value) return { state: "active" };

  // Once the blockhash is invalid, this transaction cannot newly land. The final status lookup
  // fences a transaction that landed just before expiry but has not reached settlement finality.
  const statuses = await connection.getSignatureStatuses(
    [input.signature],
    { searchTransactionHistory: true }
  );
  return statuses.value[0] ? { state: "observed" } : { state: "expired" };
}

/**
 * Synchronously validates the exact transaction bytes before a payment-submission command can be
 * durably accepted. The canonical bytes, embedded first signature, all required signatures, and
 * fee payer must agree with the submitted command and the backend-bound buyer wallet.
 */
export function validateSignedPaymentTransaction(input: {
  signature: string;
  signedTransactionBase64: string;
  buyerWallet: string | null;
}): { recentBlockhash: string } | null {
  const transaction = decodeSignedPaymentTransaction(input.signedTransactionBase64);
  if (
    !transaction ||
    !input.buyerWallet ||
    transaction.feePayer?.toBase58() !== input.buyerWallet ||
    !transaction.signature ||
    bs58.encode(transaction.signature) !== input.signature ||
    !transaction.verifySignatures() ||
    !transaction.recentBlockhash
  ) {
    return null;
  }

  return { recentBlockhash: transaction.recentBlockhash };
}

function decodeSignedPaymentTransaction(value: string): Transaction | null {
  if (value.length === 0 || value.length > 4_096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }

  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== value) return null;
    return Transaction.from(bytes);
  } catch {
    return null;
  }
}

function createAbortableSolanaConnection(
  rpcUrl: string,
  commitment: Extract<Commitment, "confirmed" | "finalized">,
  signal: AbortSignal
): Connection {
  const abortableFetch = ((input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => {
    return globalThis.fetch(
      input as Parameters<typeof globalThis.fetch>[0],
      { ...(init as RequestInit), signal }
    ) as unknown as ReturnType<FetchFn>;
  }) as FetchFn;

  return new Connection(rpcUrl, { commitment, fetch: abortableFetch });
}

export async function verifySolanaTransfer(
  connection: Connection,
  input: PaymentSettlementInput,
  commitment: Extract<Commitment, "confirmed" | "finalized"> = "finalized"
): Promise<PaymentSettlementResult> {
  if (!hasSafeSettlementAmounts(input)) {
    return {
      confirmed: false,
      failureCode: "invalid_expected_amounts"
    };
  }

  if (!isValidSolanaSignature(input.signature)) {
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

  return hasExpectedSplitTransfers(instructions, input)
    ? {
        confirmed: true,
        blockTime
      }
    : {
        confirmed: false,
        failureCode: "transfer_mismatch"
      };
}

type ExpectedTransfer = {
  sourceWallet?: string | null;
  destinationWallet: string;
  amountMinor: number;
};

function hasExpectedSplitTransfers(
  instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>,
  input: PaymentSettlementInput
): boolean {
  const expectedTransfers = expectedSplitTransfers(input);
  if (!expectedTransfers) {
    return false;
  }

  const consumedInstructionIndexes = new Set<number>();
  for (const expectedTransfer of expectedTransfers) {
    const matchingInstructionIndex = instructions.findIndex(
      (instruction, instructionIndex) =>
        !consumedInstructionIndexes.has(instructionIndex) &&
        isMatchingTransfer(instruction, input, expectedTransfer)
    );

    if (matchingInstructionIndex === -1) {
      return false;
    }

    consumedInstructionIndexes.add(matchingInstructionIndex);
  }

  return true;
}

function expectedSplitTransfers(
  input: PaymentSettlementInput
): ExpectedTransfer[] | null {
  const sourceWallet = input.buyerWallet ?? null;
  const transfers: ExpectedTransfer[] = [
    {
      sourceWallet,
      destinationWallet: input.creatorWallet,
      amountMinor: input.creatorAmountMinor
    }
  ];

  if (input.enterpriseManagementAmountMinor > 0) {
    if (!input.enterpriseWallet) {
      return null;
    }
    transfers.push({
      sourceWallet,
      destinationWallet: input.enterpriseWallet,
      amountMinor: input.enterpriseManagementAmountMinor
    });
  }

  if (input.platformFeeAmountMinor > 0) {
    transfers.push({
      sourceWallet,
      destinationWallet: input.platformFeeWallet,
      amountMinor: input.platformFeeAmountMinor
    });
  }

  if (input.referralAmountMinor > 0) {
    if (!input.referralWallet) {
      return null;
    }
    transfers.push({
      sourceWallet,
      destinationWallet: input.referralWallet,
      amountMinor: input.referralAmountMinor
    });
  }

  return transfers;
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
  const destination = deriveAssociatedTokenAddress(mint, new PublicKey(input.destinationWallet));
  const source = input.sourceWallet
    ? deriveAssociatedTokenAddress(mint, new PublicKey(input.sourceWallet))
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

export function isValidSolanaSignature(signature: string): boolean {
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
  const source = deriveAssociatedTokenAddress(mint, buyer);

  for (const transfer of splitTransfers(intent)) {
    const owner = new PublicKey(transfer.wallet);
    const destination = deriveAssociatedTokenAddress(mint, owner);
    transaction.add(
      createAssociatedTokenAccountInstruction({ payer: buyer, address: destination, owner, mint }),
      withReference(
        createCheckedTokenTransferInstruction({
          source,
          mint,
          destination,
          authority: buyer,
          amount: BigInt(transfer.amountMinor),
          decimals: intent.tokenDecimals,
          tokenProgram: TOKEN_PROGRAM_ID
        }),
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

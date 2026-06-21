import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type PartiallyDecodedInstruction
} from "@solana/web3.js";
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

export function buildSolanaPayTransferRequestUrl(input: {
  intent: StoredPaymentIntent;
  label: string;
}): string {
  assertSolanaAddress(input.intent.treasuryWallet);
  assertSolanaAddress(input.intent.referenceAddress);

  const params = new URLSearchParams({
    amount: lamportsToSol(input.intent.amountMinor),
    reference: input.intent.referenceAddress,
    label: input.label,
    message: `${input.intent.productType} ${input.intent.id}`,
    memo: `Veel:${input.intent.id}`
  });

  return `solana:${input.intent.treasuryWallet}?${params.toString()}`;
}

export function buildSolanaPayTransactionRequestUrl(input: {
  apiUrl: string;
  intentId: string;
}): string {
  const requestUrl = new URL(`/v1/payments/intents/${input.intentId}/transaction-request`, input.apiUrl).toString();
  return `solana:${encodeURIComponent(requestUrl)}`;
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

  transaction.add(
    withReference(
      SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: new PublicKey(input.intent.creatorWallet),
        lamports: input.intent.creatorAmountMinor
      }),
      reference
    )
  );

  if (input.intent.platformFeeAmountMinor > 0) {
    transaction.add(
      withReference(
        SystemProgram.transfer({
          fromPubkey: buyer,
          toPubkey: new PublicKey(input.intent.platformFeeWallet),
          lamports: input.intent.platformFeeAmountMinor
        }),
        reference
      )
    );
  }

  if (input.intent.allocationWallet && input.intent.allocationAmountMinor > 0) {
    transaction.add(
      withReference(
        SystemProgram.transfer({
          fromPubkey: buyer,
          toPubkey: new PublicKey(input.intent.allocationWallet),
          lamports: input.intent.allocationAmountMinor
        }),
        reference
      )
    );
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

export function createSolanaRpcSettlementVerifier(rpcUrl: string): PaymentSettlementVerifier {
  const connection = new Connection(rpcUrl, "confirmed");

  return {
    async verifyNativeSolTransfer(input) {
      return verifyNativeSolTransfer(connection, input);
    }
  };
}

export async function verifyNativeSolTransfer(
  connection: Connection,
  input: PaymentSettlementInput
): Promise<PaymentSettlementResult> {
  if (!isValidSignature(input.signature)) {
    return {
      confirmed: false,
      failureCode: "invalid_signature"
    };
  }

  const transaction = await connection.getParsedTransaction(input.signature, {
    commitment: "confirmed",
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
      isMatchingNativeSolTransfer(instruction, {
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
    isMatchingNativeSolTransfer(instruction, {
      sourceWallet: input.buyerWallet ?? null,
      destinationWallet: input.creatorWallet,
      amountMinor: input.creatorAmountMinor
    })
  );
  const hasPlatformFeeTransfer =
    input.platformFeeAmountMinor === 0 ||
    instructions.some((instruction) =>
      isMatchingNativeSolTransfer(instruction, {
        sourceWallet: input.buyerWallet ?? null,
        destinationWallet: input.platformFeeWallet,
        amountMinor: input.platformFeeAmountMinor
      })
    );
  const hasAllocationTransfer =
    input.allocationAmountMinor === 0 ||
    hasExpectedAllocationTransfer(instructions, input);

  return hasCreatorTransfer && hasPlatformFeeTransfer && hasAllocationTransfer
    ? {
        confirmed: true
      }
    : {
        confirmed: false,
        failureCode: "transfer_mismatch"
      };
}

function hasExpectedAllocationTransfer(
  instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>,
  input: PaymentSettlementInput
): boolean {
  if (!input.allocationWallet) {
    return false;
  }

  const allocationWallet = input.allocationWallet;
  return instructions.some((instruction) =>
    isMatchingNativeSolTransfer(instruction, {
      sourceWallet: input.buyerWallet ?? null,
      destinationWallet: allocationWallet,
      amountMinor: input.allocationAmountMinor
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

function isMatchingMemo(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
  memo: string
): boolean {
  if ("parsed" in instruction) {
    return instruction.program === "spl-memo" && instruction.parsed === memo;
  }

  return instruction.programId.toBase58() === MEMO_PROGRAM_ID.toBase58();
}

function lamportsToSol(lamports: number): string {
  const whole = Math.trunc(lamports / LAMPORTS_PER_SOL);
  const fractional = Math.abs(lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  return `${whole}.${fractional}`.replace(/\.?0+$/, "");
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

export function paymentMemo(intentId: string): string {
  return `veel:${intentId}`;
}

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

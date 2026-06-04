import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedInstruction,
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

  const hasMatchingTransfer = transaction.transaction.message.instructions.some((instruction) =>
    isMatchingNativeSolTransfer(instruction, input)
  );

  return hasMatchingTransfer
    ? {
        confirmed: true
      }
    : {
        confirmed: false,
        failureCode: "transfer_mismatch"
      };
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
  input: PaymentSettlementInput
): boolean {
  if (!("parsed" in instruction)) {
    return false;
  }

  if (instruction.program !== "system" || instruction.parsed?.type !== "transfer") {
    return false;
  }

  const info = instruction.parsed.info as {
    destination?: string;
    lamports?: number;
  };

  return info.destination === input.treasuryWallet && Number(info.lamports) === input.amountMinor;
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

import {
  address,
  createNoopSigner,
  type Instruction as KitInstruction
} from "@solana/kit";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  getCreateAssociatedTokenIdempotentInstruction,
  getTokenDecoder,
  getTokenSize,
  getTransferCheckedInstruction
} from "@solana-program/token";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS);
export const TOKEN_PROGRAM_ID = new PublicKey(TOKEN_PROGRAM_ADDRESS);
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export function deriveAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

export function createAssociatedTokenAccountInstruction(input: {
  payer: PublicKey;
  address: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgram?: PublicKey;
}): TransactionInstruction {
  return toLegacyInstruction(getCreateAssociatedTokenIdempotentInstruction({
    payer: createNoopSigner(address(input.payer.toBase58())),
    ata: address(input.address.toBase58()),
    owner: address(input.owner.toBase58()),
    mint: address(input.mint.toBase58()),
    tokenProgram: address((input.tokenProgram ?? TOKEN_PROGRAM_ID).toBase58())
  }));
}

export function createCheckedTokenTransferInstruction(input: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  authority: PublicKey;
  amount: bigint;
  decimals: number;
  tokenProgram?: PublicKey;
}): TransactionInstruction {
  return toLegacyInstruction(getTransferCheckedInstruction({
    source: address(input.source.toBase58()),
    mint: address(input.mint.toBase58()),
    destination: address(input.destination.toBase58()),
    authority: createNoopSigner(address(input.authority.toBase58())),
    amount: input.amount,
    decimals: input.decimals
  }, {
    programAddress: address((input.tokenProgram ?? TOKEN_PROGRAM_ID).toBase58())
  }));
}

export function decodeTokenAccount(data: Uint8Array): { mint: string; owner: string } {
  const token = getTokenDecoder().decode(data.subarray(0, getTokenSize()));
  return { mint: token.mint, owner: token.owner };
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

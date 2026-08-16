#!/usr/bin/env node
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import postgres from "postgres";

const canonicalProgramId = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const tokenProgramIds = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
]);
const required = [
  "DATABASE_URL",
  "SUBSCRIPTIONS_SOLANA_RPC_URL",
  "SUBSCRIPTIONS_SOLANA_PROGRAM_ID",
  "SUBSCRIPTIONS_DEFAULT_MINT",
  "SUBSCRIPTIONS_COLLECTOR_WALLET",
  "SUBSCRIPTIONS_COLLECTOR_PRIVATE_KEY",
  "SUBSCRIPTIONS_STAGING_AUTHORIZATION_SIGNATURE",
  "SUBSCRIPTIONS_STAGING_COLLECTION_SIGNATURE"
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`CODE_COMPLETE_PROVIDER_BLOCKED missing=${missing.join(",")}`);
  process.exit(2);
}
if (process.env.SUBSCRIPTIONS_SOLANA_PROGRAM_ID !== canonicalProgramId) {
  throw new Error("Configured program ID is not the canonical Solana subscriptions program");
}

const collector = Keypair.fromSecretKey(bs58.decode(process.env.SUBSCRIPTIONS_COLLECTOR_PRIVATE_KEY));
if (collector.publicKey.toBase58() !== process.env.SUBSCRIPTIONS_COLLECTOR_WALLET) {
  throw new Error("Collector private key does not match SUBSCRIPTIONS_COLLECTOR_WALLET");
}
const connection = new Connection(process.env.SUBSCRIPTIONS_SOLANA_RPC_URL, "finalized");
const programKey = new PublicKey(canonicalProgramId);
const mintKey = new PublicKey(process.env.SUBSCRIPTIONS_DEFAULT_MINT);
const [program, mint, genesisHash, authorization, collection] = await Promise.all([
  connection.getAccountInfo(programKey, "finalized"),
  connection.getAccountInfo(mintKey, "finalized"),
  connection.getGenesisHash(),
  connection.getTransaction(process.env.SUBSCRIPTIONS_STAGING_AUTHORIZATION_SIGNATURE, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0
  }),
  connection.getTransaction(process.env.SUBSCRIPTIONS_STAGING_COLLECTION_SIGNATURE, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0
  })
]);
if (!program?.executable) throw new Error("Subscriptions program is missing or not executable");
if (!mint || !tokenProgramIds.has(mint.owner.toBase58())) {
  throw new Error("Default mint is not owned by a supported token program");
}
assertSuccessfulProgramTransaction(authorization, "authorization");
assertSuccessfulProgramTransaction(collection, "collection");
if (collection.transaction.message.getAccountKeys().staticAccountKeys[0]?.toBase58() !== collector.publicKey.toBase58()) {
  throw new Error("Collection transaction was not fee-paid by the configured collector");
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const rows = await sql`
    select
      sc.state,
      sc.amount_atomic,
      sc.creator_amount_atomic,
      sc.platform_fee_amount_atomic,
      sc.allocation_amount_atomic,
      s.state as subscription_state,
      sp.provider_state
    from subscription_collections sc
    join subscriptions s on s.id = sc.subscription_id
    join subscription_plans sp on sp.id = s.plan_id
    where sc.collection_signature = ${process.env.SUBSCRIPTIONS_STAGING_COLLECTION_SIGNATURE}
    limit 1
  `;
  const proof = rows[0];
  if (!proof || proof.state !== "confirmed" || proof.subscription_state !== "active") {
    throw new Error("Staging collection is not confirmed and access-active in the backend ledger");
  }
  if (
    BigInt(proof.creator_amount_atomic) +
      BigInt(proof.platform_fee_amount_atomic) +
      BigInt(proof.allocation_amount_atomic) !==
    BigInt(proof.amount_atomic)
  ) {
    throw new Error("Staging collection split does not equal the exact gross amount");
  }
  if (proof.provider_state !== "launch_approved") {
    throw new Error("Staging plan is not launch-approved for the proven use case");
  }
} finally {
  await sql.end({ timeout: 5 });
}

console.log(JSON.stringify({
  status: "PASS",
  provider: "official_solana_subscription_program",
  programId: canonicalProgramId,
  genesisHash,
  authorizationSignature: redact(process.env.SUBSCRIPTIONS_STAGING_AUTHORIZATION_SIGNATURE),
  collectionSignature: redact(process.env.SUBSCRIPTIONS_STAGING_COLLECTION_SIGNATURE)
}, null, 2));

function assertSuccessfulProgramTransaction(transaction, label) {
  if (!transaction || transaction.meta?.err) throw new Error(`${label} transaction is missing or failed`);
  const keys = transaction.transaction.message.getAccountKeys().staticAccountKeys;
  if (!transaction.transaction.message.compiledInstructions.some(
    (instruction) => keys[instruction.programIdIndex]?.equals(programKey)
  )) {
    throw new Error(`${label} transaction does not invoke the canonical program`);
  }
}

function redact(value) {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

#!/usr/bin/env node
import { compareStorageTrees } from "./storage-restore-proof-lib.mjs";

if (process.env.STORAGE_RESTORE_PROOF_ACK !== "COMPARE_DISPOSABLE_NONPRODUCTION_STORAGE") {
  throw new Error("Set STORAGE_RESTORE_PROOF_ACK=COMPARE_DISPOSABLE_NONPRODUCTION_STORAGE");
}

const proof = await compareStorageTrees(
  process.env.STORAGE_BACKUP_SOURCE_DIR,
  process.env.STORAGE_RESTORE_TARGET_DIR
);
console.log(JSON.stringify(proof, null, 2));
if (proof.status !== "PASS") process.exitCode = 1;

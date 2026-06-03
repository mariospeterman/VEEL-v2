const command = process.argv[2] ?? "command";

console.error(
  `${command} is intentionally unavailable until the foundation slice creates real app/package tooling.`,
);
console.error("Run `pnpm docs:check` for the current documentation scaffold.");
process.exit(1);

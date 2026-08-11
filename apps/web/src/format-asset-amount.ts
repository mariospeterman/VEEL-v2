export function formatAssetAmount(
  amountAtomic: number | string,
  currency: "SOL" | "USDC" | string
): string {
  const decimals = currency === "SOL" ? 9 : currency === "USDC" ? 6 : 0;
  const amount = BigInt(amountAtomic);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = decimals === 0 ? absolute : absolute / divisor;
  const fractional =
    decimals === 0
      ? ""
      : (absolute % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const display = `${negative ? "-" : ""}${groupedWhole}${fractional ? `.${fractional}` : ""}`;

  return `${display} ${currency}`;
}


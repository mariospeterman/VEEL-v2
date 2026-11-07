import { Buffer } from "node:buffer";
import { encodeURL, parseURL } from "@solana/pay";
import QRCode from "qrcode";

export interface SolanaPayTransactionRequestInput {
  link: string;
  label?: string;
  message?: string;
}

export interface ParsedSolanaPayTransactionRequest {
  link: string;
  label: string | null;
  message: string | null;
}

export function encodeSolanaPayTransactionRequest(
  input: SolanaPayTransactionRequestInput
): string {
  return encodeURL({
    link: new URL(input.link),
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.message === undefined ? {} : { message: input.message })
  }).toString();
}

export function parseSolanaPayTransactionRequest(
  value: string
): ParsedSolanaPayTransactionRequest {
  const parsed = parseURL(value);

  if (!("link" in parsed)) {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  }

  return {
    link: parsed.link.toString(),
    label: parsed.label ?? null,
    message: parsed.message ?? null
  };
}

export async function createSolanaPaySvgDataUrl(value: string): Promise<string> {
  const svg = await QRCode.toString(value, {
    type: "svg",
    width: 320,
    margin: 2,
    color: {
      dark: "#08130f",
      light: "#ffffff"
    },
    errorCorrectionLevel: "M"
  });

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

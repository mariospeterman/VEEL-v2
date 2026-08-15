import {
  createQRDataURL,
  encodeTransactionRequestURL
} from "@solana-commerce/solana-pay";

export const commerceKitSolanaPayVersion = "0.1.1";
export const commerceKitReviewedCommit = "6164d5104f3d1bd4cfbb637075f000d6ac23d6c3";

export interface WeVidSolanaPayRequest {
  transactionRequestUrl: string;
  checkoutUrl: string;
  qrDataUrl: string;
}

export function encodeWeVidTransactionRequest(input: {
  apiUrl: string;
  checkoutToken: string;
}): { transactionRequestUrl: string; checkoutUrl: string } {
  const checkoutUrl = new URL(
    `/v1/payments/checkout/${encodeURIComponent(input.checkoutToken)}`,
    input.apiUrl
  );
  const codecLink = new URL(checkoutUrl);
  if (isLocalHttpUrl(codecLink)) {
    codecLink.protocol = "https:";
  }
  const encoded = encodeTransactionRequestURL({
    link: codecLink,
    label: "WeVid",
    message: "Approve this payment in your wallet"
  });
  // Commerce Kit 0.1.1 returns the HTTPS callback directly even though its parser
  // requires a solana: URL. Keep that provider quirk inside this compatibility boundary.
  const transactionRequestUrl = `solana:${checkoutUrl.origin}${checkoutUrl.pathname}${encoded.search}`;
  const parsed = parseWeVidTransactionRequest(transactionRequestUrl);

  if (parsed.checkoutUrl !== checkoutUrl.toString()) {
    throw new Error("SOLANA_PAY_CODEC_ROUND_TRIP_FAILED");
  }

  return {
    transactionRequestUrl,
    checkoutUrl: checkoutUrl.toString()
  };
}

export function parseWeVidTransactionRequest(value: string | URL): {
  checkoutUrl: string;
  label: string | null;
  message: string | null;
} {
  const requestUrl = value instanceof URL ? value : new URL(value);
  if (requestUrl.protocol !== "solana:" || !/^https?:\/\//.test(requestUrl.pathname)) {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  }
  const link = new URL(`${requestUrl.pathname}${requestUrl.search}`);
  if (link.protocol !== "https:" && !isLocalHttpUrl(link)) {
    throw new Error("SOLANA_PAY_CHECKOUT_URL_NOT_ALLOWED");
  }

  return {
    checkoutUrl: `${link.origin}${link.pathname}`,
    label: link.searchParams.get("label"),
    message: link.searchParams.get("message")
  };
}

export async function createWeVidTransactionRequest(input: {
  apiUrl: string;
  checkoutToken: string;
}): Promise<WeVidSolanaPayRequest> {
  const request = encodeWeVidTransactionRequest(input);
  const qrDataUrl = await createQRDataURL(request.transactionRequestUrl, {
    width: 320,
    margin: 2,
    color: {
      dark: "#08130f",
      light: "#ffffff"
    },
    errorCorrectionLevel: "M"
  });

  return {
    ...request,
    qrDataUrl
  };
}

export function createStoredWeVidTransactionRequestUrl(apiUrl: string): string {
  return encodeWeVidTransactionRequest({
    apiUrl,
    checkoutToken: "redacted"
  }).transactionRequestUrl;
}

function isLocalHttpUrl(value: URL): boolean {
  return (
    value.protocol === "http:" &&
    (value.hostname === "localhost" || value.hostname === "127.0.0.1")
  );
}

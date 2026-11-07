import {
  createSolanaPaySvgDataUrl,
  encodeSolanaPayTransactionRequest,
  parseSolanaPayTransactionRequest
} from "@veel/solana-pay-codec";

const checkoutPathPrefix = "/v1/payments/checkout/";
const checkoutTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const redactedCheckoutToken = "redacted";
const transactionRequestLabel = "WeVid";
const transactionRequestMessage = "Approve this payment in your wallet";

export interface WeVidSolanaPayRequest {
  transactionRequestUrl: string;
  checkoutUrl: string;
  qrDataUrl: string;
}

export function encodeWeVidTransactionRequest(input: {
  apiUrl: string;
  checkoutToken: string;
}): { transactionRequestUrl: string; checkoutUrl: string } {
  return encodeTransactionRequest(input, false);
}

export function parseWeVidTransactionRequest(
  value: string | URL,
  apiUrl: string
): {
  checkoutUrl: string;
  label: string | null;
  message: string | null;
} {
  return parseTransactionRequest(value, apiUrl, false);
}

export async function createWeVidTransactionRequest(input: {
  apiUrl: string;
  checkoutToken: string;
}): Promise<WeVidSolanaPayRequest> {
  const request = encodeWeVidTransactionRequest(input);

  return {
    ...request,
    qrDataUrl: await createSolanaPaySvgDataUrl(request.transactionRequestUrl)
  };
}

export function createStoredWeVidTransactionRequestUrl(apiUrl: string): string {
  return encodeTransactionRequest(
    {
      apiUrl,
      checkoutToken: redactedCheckoutToken
    },
    true
  ).transactionRequestUrl;
}

function encodeTransactionRequest(
  input: {
    apiUrl: string;
    checkoutToken: string;
  },
  allowRedactedToken: boolean
): { transactionRequestUrl: string; checkoutUrl: string } {
  assertCheckoutToken(input.checkoutToken, allowRedactedToken);
  const apiOrigin = normalizedApiOrigin(input.apiUrl);
  const checkoutUrl = new URL(`${checkoutPathPrefix}${input.checkoutToken}`, apiOrigin);
  const codecLink = new URL(checkoutUrl);

  if (isLocalHttpUrl(codecLink)) {
    codecLink.protocol = "https:";
  }

  const encoded = encodeSolanaPayTransactionRequest({
    link: codecLink.toString(),
    label: transactionRequestLabel,
    message: transactionRequestMessage
  });
  const transactionRequestUrl = isLocalHttpUrl(checkoutUrl)
    ? restoreLocalHttpLink(encoded, checkoutUrl)
    : encoded;
  const parsed = parseTransactionRequest(
    transactionRequestUrl,
    apiOrigin.toString(),
    allowRedactedToken
  );

  if (parsed.checkoutUrl !== checkoutUrl.toString()) {
    throw new Error("SOLANA_PAY_CODEC_ROUND_TRIP_FAILED");
  }

  return {
    transactionRequestUrl,
    checkoutUrl: checkoutUrl.toString()
  };
}

function parseTransactionRequest(
  value: string | URL,
  apiUrl: string,
  allowRedactedToken: boolean
): {
  checkoutUrl: string;
  label: string | null;
  message: string | null;
} {
  const apiOrigin = normalizedApiOrigin(apiUrl);
  const requestUrl = transactionRequestUrl(value);
  const metadata = transactionRequestMetadata(requestUrl);
  const decodedPath = decodeTransactionRequestPath(requestUrl.pathname);
  let parsed: { link: string; label: string | null; message: string | null };

  if (decodedPath.startsWith("http://")) {
    const localLink = checkoutLink(decodedPath);

    if (!isLocalHttpUrl(localLink)) {
      throw new Error("SOLANA_PAY_CHECKOUT_URL_NOT_ALLOWED");
    }

    const codecLink = new URL(localLink);
    codecLink.protocol = "https:";
    const codecRequest = encodeSolanaPayTransactionRequest({
      link: codecLink.toString(),
      label: metadata.label,
      message: metadata.message
    });
    const codecParsed = parseSdkTransactionRequest(codecRequest);
    const restoredLink = new URL(codecParsed.link);
    restoredLink.protocol = "http:";
    parsed = {
      link: restoredLink.toString(),
      label: codecParsed.label,
      message: codecParsed.message
    };
  } else {
    parsed = parseSdkTransactionRequest(requestUrl.toString());
  }

  if (parsed.label !== metadata.label || parsed.message !== metadata.message) {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_METADATA_INVALID");
  }

  const link = checkoutLink(parsed.link);
  assertCheckoutLink(link, apiOrigin, allowRedactedToken);

  return {
    checkoutUrl: `${link.origin}${link.pathname}`,
    label: parsed.label,
    message: parsed.message
  };
}

function normalizedApiOrigin(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("SOLANA_PAY_API_URL_NOT_ALLOWED");
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && !isLocalHttpUrl(url))
  ) {
    throw new Error("SOLANA_PAY_API_URL_NOT_ALLOWED");
  }

  return new URL(url.origin);
}

function transactionRequestUrl(value: string | URL): URL {
  const serialized = value instanceof URL ? value.toString() : value;
  let requestUrl: URL;

  if (serialized.length > 2048) {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  }

  try {
    requestUrl = new URL(serialized);
  } catch {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  }

  if (
    requestUrl.protocol !== "solana:" ||
    !requestUrl.pathname ||
    !/[:%]/u.test(requestUrl.pathname)
  ) {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  }

  if (requestUrl.username || requestUrl.password || requestUrl.hash) {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_FRAGMENT_OR_USERINFO_NOT_ALLOWED");
  }

  return requestUrl;
}

function transactionRequestMetadata(requestUrl: URL): {
  label: string;
  message: string;
} {
  const allowedKeys = new Set(["label", "message"]);

  if ([...requestUrl.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_METADATA_INVALID");
  }

  const labels = requestUrl.searchParams.getAll("label");
  const messages = requestUrl.searchParams.getAll("message");
  if (
    labels.length !== 1 ||
    messages.length !== 1 ||
    labels[0] !== transactionRequestLabel ||
    messages[0] !== transactionRequestMessage
  ) {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_METADATA_INVALID");
  }

  return {
    label: labels[0],
    message: messages[0]
  };
}

function decodeTransactionRequestPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  }
}

function parseSdkTransactionRequest(value: string): {
  link: string;
  label: string | null;
  message: string | null;
} {
  try {
    return parseSolanaPayTransactionRequest(value);
  } catch {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  }
}

function checkoutLink(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error("SOLANA_PAY_TRANSACTION_REQUEST_REQUIRED");
  }
}

function assertCheckoutLink(
  link: URL,
  apiOrigin: URL,
  allowRedactedToken: boolean
): void {
  if (link.username || link.password || link.search || link.hash) {
    throw new Error("SOLANA_PAY_CHECKOUT_URL_NOT_ALLOWED");
  }

  if (link.protocol !== apiOrigin.protocol || link.origin !== apiOrigin.origin) {
    throw new Error("SOLANA_PAY_CHECKOUT_ORIGIN_NOT_ALLOWED");
  }

  if (!link.pathname.startsWith(checkoutPathPrefix)) {
    throw new Error("SOLANA_PAY_CHECKOUT_PATH_NOT_ALLOWED");
  }

  const checkoutToken = link.pathname.slice(checkoutPathPrefix.length);
  if (checkoutToken.includes("/") || !checkoutToken) {
    throw new Error("SOLANA_PAY_CHECKOUT_PATH_NOT_ALLOWED");
  }

  assertCheckoutToken(checkoutToken, allowRedactedToken);
}

function assertCheckoutToken(value: string, allowRedactedToken: boolean): void {
  if (
    !checkoutTokenPattern.test(value) &&
    !(allowRedactedToken && value === redactedCheckoutToken)
  ) {
    throw new Error("SOLANA_PAY_CHECKOUT_TOKEN_INVALID");
  }
}

function restoreLocalHttpLink(encoded: string, checkoutUrl: URL): string {
  const encodedUrl = new URL(encoded);
  return `solana:${checkoutUrl.origin}${checkoutUrl.pathname}${encodedUrl.search}`;
}

function isLocalHttpUrl(value: URL): boolean {
  return (
    value.protocol === "http:" &&
    (value.hostname === "localhost" || value.hostname === "127.0.0.1")
  );
}

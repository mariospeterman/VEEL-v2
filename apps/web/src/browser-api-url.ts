const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Keep browser-to-API requests on the same loopback site during local previews.
 *
 * A page opened at 127.0.0.1 with an API configured as localhost is cross-site.
 * Browsers therefore withhold the HttpOnly SameSite application cookie on the
 * next API request even though both names resolve to this machine.
 */
export function browserApiUrl(path: string, apiBaseUrl: string, browserUrl = window.location.href) {
  const apiUrl = new URL(path, apiBaseUrl);
  const pageUrl = new URL(browserUrl);

  if (loopbackHosts.has(apiUrl.hostname) && loopbackHosts.has(pageUrl.hostname)) {
    apiUrl.hostname = pageUrl.hostname;
  }

  return apiUrl;
}

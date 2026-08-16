#!/usr/bin/env node

const webUrl = new URL(process.env.WEB_URL ?? "http://127.0.0.1:3000");
const apiUrl = new URL(process.env.API_URL ?? "http://127.0.0.1:4000");

async function expectResponse(url, expectedType) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes(expectedType)) throw new Error(`${url} returned unexpected content type ${contentType}`);
  return response;
}

await expectResponse(new URL("/", webUrl), "text/html");
const runtimeConfig = await expectResponse(new URL("/runtime-config.js", webUrl), "javascript");
if ((runtimeConfig.headers.get("cache-control") ?? "").includes("no-store") === false) {
  throw new Error("runtime-config.js must be no-store");
}
for (const route of ["/healthz", "/readyz"]) {
  const response = await expectResponse(new URL(route, apiUrl), "application/json");
  const body = await response.json();
  if (body.status !== "ok") throw new Error(`${route} did not report ok`);
}
console.log("Synthetic web, runtime configuration, API liveness, and API readiness passed");

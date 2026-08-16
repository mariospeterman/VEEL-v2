#!/usr/bin/env node

const target = new URL(process.env.LOAD_TARGET_URL ?? `${process.env.API_URL ?? "http://127.0.0.1:4000"}/healthz`);
const requests = Number(process.env.LOAD_REQUESTS ?? 100);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 10);
const maxP95Ms = Number(process.env.LOAD_MAX_P95_MS ?? 500);
const maxErrorRate = Number(process.env.LOAD_MAX_ERROR_RATE ?? 0.01);

if (!Number.isInteger(requests) || requests < 1 || requests > 10_000) throw new Error("LOAD_REQUESTS must be 1..10000");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error("LOAD_CONCURRENCY must be 1..100");
if (target.hostname !== "localhost" && target.hostname !== "127.0.0.1" && process.env.LOAD_REMOTE_ACK !== "I_ACKNOWLEDGE_BOUNDED_LOAD") {
  throw new Error("Remote load requires LOAD_REMOTE_ACK=I_ACKNOWLEDGE_BOUNDED_LOAD");
}

const timings = [];
let failures = 0;
let cursor = 0;
async function worker() {
  while (cursor < requests) {
    cursor += 1;
    const started = performance.now();
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    } finally {
      timings.push(performance.now() - started);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
timings.sort((a, b) => a - b);
const percentile = (p) => timings[Math.min(timings.length - 1, Math.ceil(timings.length * p) - 1)];
const result = { requests, failures, errorRate: failures / requests, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
console.log(JSON.stringify(result));
if (result.errorRate > maxErrorRate || result.p95Ms > maxP95Ms) throw new Error("Bounded load thresholds failed");

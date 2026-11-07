import { createHash, createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from './db-proof-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { normalizeVerificationWebhook } from './wevid-audit/apps/api/dist/modules/verification/verification-webhook-adapter.js';
import { normalizeAgeWebhook } from './wevid-audit/apps/api/dist/modules/age/age-webhook-adapter.js';

// Actual compiled adapters from the same source SHA, using signed documented
// payload shapes. No live provider is contacted. Only the event receipt's real
// uniqueness constraints are exercised in a reduced PostgreSQL fixture.
const secret = 'audit-only-synthetic-secret';
const env = { SUMSUB_WEBHOOK_SECRET: secret };
const bodies = [
  { applicantId: 'actual-applicant-id', externalUserId: 'user:canonical-id', correlationId: 'shared-operation-request-id', type: 'applicantPending', reviewStatus: 'pending', createdAtMs: '2026-11-04 10:00:00.000' },
  { applicantId: 'actual-applicant-id', externalUserId: 'user:canonical-id', correlationId: 'shared-operation-request-id', type: 'applicantReviewed', reviewStatus: 'completed', reviewResult: { reviewAnswer: 'GREEN' }, createdAtMs: '2026-11-04 10:01:00.000' }
];
const generic = [], age = [];
for (const body of bodies) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const headers = { 'x-payload-digest': createHmac('sha256', secret).update(rawBody).digest('hex'), 'x-payload-digest-alg': 'HMAC_SHA256_HEX' };
  const input = { provider: 'sumsub', body, rawBody, headers, env };
  generic.push({ ...normalizeVerificationWebhook(input), payloadHash: createHash('sha256').update(rawBody).digest('hex') });
  age.push(normalizeAgeWebhook(input));
}
const migration = await readFile('./wevid-complete/packages/database/migrations/0069_normalized_verification_domain.sql', 'utf8');
const tableSql = migration.match(/create table verification_events \([\s\S]*?\n\);/)[0];
const db = new PGlite();
await db.exec('create table verification_sessions(id uuid primary key)');
await db.exec(tableSql);
const receiptOutcomes = [];
for (const event of generic) {
  const result = await db.query(`insert into verification_events(provider,event_type,idempotency_key,payload_hash,processing_status) values($1,$2,$3,$4,'received') on conflict do nothing returning id`, [event.provider,event.eventType,event.providerEventId,event.payloadHash]);
  receiptOutcomes.push({ eventType: event.eventType, state: event.status, receiptInserted: result.rows.length === 1 });
}
const result = { sourceSha: '71ceabcfaa8a5258e1b935a391ff4e6e7330c682', runtime: process.version, proofBoundary: 'Actual compiled signed Sumsub normalization; exact migration verification_events table under reduced PGlite fixture; no live provider or full session/route run', generic, age, receiptOutcomes, observed: 'Pending event accepted; distinct later authentic-shaped approved event has same idempotency key and is suppressed as duplicate.' };
await writeFile('./verification-sumsub-event-proof.json', JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({generic:generic.map(x=>({eventType:x.eventType,providerEventId:x.providerEventId,status:x.status})),age:age.map(x=>({eventType:x.eventType,providerEventId:x.providerEventId,state:x.state})),receiptOutcomes},null,2));
await db.close();

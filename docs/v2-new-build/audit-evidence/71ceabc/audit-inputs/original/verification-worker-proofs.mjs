import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AnalyticsQueryService } from './wevid-audit/apps/api/dist/modules/analytics/analytics-service.js';
import { buildApi } from './wevid-audit/apps/api/dist/app.js';
import { deriveJourneyResults } from './wevid-complete/scripts/staging-acceptance-status.mjs';

// Disposable dependency/transport fixtures only. This never calls a real provider.
for (const path of ['apps/api/src/modules/analytics/analytics-service.ts', 'apps/api/src/app.ts']) {
  assert.equal(fs.readFileSync(`wevid-complete/${path}`, 'utf8'), fs.readFileSync(`wevid-audit/${path}`, 'utf8'));
}
const service = new AnalyticsQueryService({
  authorizeScope: async (_, scope) => scope,
  getWatermark: async () => null,
  queryMetric: async () => [{ bucketDate: null, value: '3', numerator: null, denominator: null, sampleSize: '3' }],
  recordSuppression: async () => {}
});
const result = await service.query('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
  scope: { type: 'creator', creatorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  window: { startDate: '2026-11-01', endDate: '2026-11-01' },
  granularity: 'total', timezone: 'UTC', metricKeys: ['creator.social.follower_starts']
});
assert.equal(result.metrics[0].points[0].value, null);
assert.equal(result.metrics[0].points[0].sampleSize, '3');
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
const app = await buildApi();
app.get('/verification-error', async () => { throw new Error('VERIFICATION_INTERNAL_SENTINEL'); });
const response = await app.inject('/verification-error');
await app.close();
assert.equal(response.statusCode, 500);
assert.equal(response.json().message, 'VERIFICATION_INTERNAL_SENTINEL');
const status = deriveJourneyResults({
  journeys: [{ id: 'admin.operational_readiness', status: 'PASS', blockerClass: null }],
  capabilityStatus: new Map()
});
assert.equal(status[0].status, 'PASS');

const env = {
  API_URL: 'https://staging.example',
  ENTERPRISE_STAGING_SESSION_COOKIE: 'audit_fake_cookie',
  ENTERPRISE_STAGING_ORGANIZATION_ID: 'org1',
  ENTERPRISE_STAGING_RELATIONSHIP_ID: 'rel1',
  ENTERPRISE_STAGING_KYB_EVIDENCE_ID: 'not-an-evidence-id',
  ENTERPRISE_STAGING_CONTRACT_EVIDENCE_ID: 'also-not-evidence'
};
const requests = [];
let output = '';
const fakeFetch = async (url) => {
  requests.push(String(url));
  return { ok: true, json: async () => String(url).endsWith('/reporting')
    ? { relationshipId: 'rel1', financeBoundary: 'confirmed_allocations_only_no_balance_no_withdrawal_no_payout_queue' }
    : String(url).endsWith('/organizations')
      ? { items: [{ organization: { organizationId: 'org1', state: 'active' }, governance: { kybState: 'verified' }, capabilities: { rbacEnabled: true } }] }
      : { items: [{ id: 'rel1', organizationId: 'org1', state: 'active', agreementState: 'accepted', organizationKybReady: true, enterpriseEntitlementReady: true, settlementWalletReady: true }] }
  };
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
await new AsyncFunction('process', 'fetch', 'console', fs.readFileSync('wevid-complete/apps/api/scripts/prove-enterprise-managed-creators.mjs', 'utf8'))(
  { env, exit: (code) => { throw Error(`Unexpected exit ${code}`); } },
  fakeFetch,
  { log: (text) => { output += text; }, error: (text) => { throw Error(text); } }
);
assert.equal(JSON.parse(output).state, 'PROVIDER_PROVEN');
assert.equal(requests.length, 3);
const evidence = {
  method: 'Independent re-execution of actual compiled service/API plus exact scripts with dependency/transport fixtures; no network/hosted database/provider execution',
  runtime: process.version,
  sourceMatchesBetweenCheckouts: true,
  suppression: result.metrics[0].points[0],
  error: { status: response.statusCode, message: response.json().message },
  journey: status[0],
  invalidEnterpriseEvidenceAccepted: JSON.parse(output).state,
  enterpriseRequests: requests
};
fs.writeFileSync('verification-worker-proofs.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));

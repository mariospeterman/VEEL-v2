import { writeFile } from 'node:fs/promises';
import { createVerificationProviderWaterfall } from './wevid-audit/apps/api/dist/modules/verification/verification-provider-adapters.js';

const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({url:String(url),method:init.method,body:JSON.parse(init.body)});
  return new Response(JSON.stringify({ token:'audit-only-sdk-token', userId:'user:canonical-id' }),{status:200,headers:{'content-type':'application/json'}});
};
let session;
try {
  session = await createVerificationProviderWaterfall({NODE_ENV:'production',AGE_VERIFICATION_ALLOW_MOCK_PROVIDER:false,SUMSUB_APP_TOKEN:'synthetic-app-token',SUMSUB_SECRET_KEY:'synthetic-secret',SUMSUB_LEVEL_NAME:'age-level',SUMSUB_API_BASE_URL:'https://api.sumsub.com'}).createSession({supabaseUserId:'canonical-id',purpose:'age_access',providerPreference:'sumsub',idempotencyKey:'audit-launch',callbackUrl:'https://wevid.example/age/callback',webhookBaseUrl:'https://api.wevid.example/v1/webhooks/age'});
} finally {globalThis.fetch=originalFetch;}
const result = {sourceSha:'71ceabcfaa8a5258e1b935a391ff4e6e7330c682',runtime:process.version,proofBoundary:'Actual compiled adapter with official documented token response shape supplied by synthetic fetch; no provider/browser call',requests,session,launchOrigin:new URL(session.launchUrl).origin,launchPath:new URL(session.launchUrl).pathname,observed:'Launch points to the WeVid callback rather than a hosted Sumsub verification or an implemented SDK launcher. Frontend static trace shows callback redirects directly to age-return polling and drops token.'};
await writeFile('./verification-sumsub-launch-proof.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));

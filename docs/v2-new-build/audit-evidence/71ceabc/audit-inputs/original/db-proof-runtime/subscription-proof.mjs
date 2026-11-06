import { PGlite } from './node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from './node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
import { stripTypeScriptTypes } from 'node:module';
import fs from 'node:fs';
const db=new PGlite({extensions:{pgcrypto}});
await db.exec(`create extension pgcrypto; create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$; create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$; create publication supabase_realtime;`);
const dir='/workspace/scratch/0635fbdaf32f/wevid-audit/packages/database/migrations/';
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.endsWith('.down.sql')).sort())await db.exec(fs.readFileSync(dir+f,'utf8'));
await db.exec(`insert into users(id) values('00000000-0000-4000-8000-000000000001');
update subscription_plans set state='active',provider_state='launch_approved',token_mint='mint',merchant_wallet='platform',program_id='program' where id='platform_plus_monthly';
insert into subscriptions(id,subscriber_user_id,scope,plan_id,state,renewal_mode,authority_address,delegation_address,subscriber_token_account,collector_address,subscriber_wallet,token_mint,program_id,amount_atomic,period_seconds,next_collection_at,verified_at) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','platform','platform_plus_monthly','renewal_pending','delegated_solana_subscription','authority','delegation','ata','collector','wallet','mint','program',8990000,2592000,'2026-11-04T00:00:00Z','2026-11-04T00:00:00Z');`);
function tagFor(client){
 const tag=async(strings,...values)=>{
  if(!Array.isArray(strings)||!('raw' in strings))throw Error('unexpected fragment');
  let text=strings[0];for(let i=0;i<values.length;i++)text+='$'+(i+1)+strings[i+1];
  const rs=await client.query(text,values.map(v=>v instanceof Date?v.toISOString():v));return rs.rows;
 };
 tag.begin=async cb=>db.transaction(tx=>cb(tagFor(tx)));
 tag.json=v=>JSON.stringify(v);tag.end=async()=>{};
 return tag;
}
globalThis.__wevidPgShim=()=>tagFor(db);
let code=fs.readFileSync('/workspace/scratch/0635fbdaf32f/wevid-audit/apps/worker/src/subscription-collections.ts','utf8');
code=code.slice(code.indexOf('export function createPostgresSubscriptionCollectionRepository('));
code="import {randomUUID} from 'node:crypto'; const postgres=globalThis.__wevidPgShim;\n"+stripTypeScriptTypes(code,{mode:'transform'});
const mod=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const repo=mod.createPostgresSubscriptionCollectionRepository('pglite');
const planDebug=(await db.query("select * from subscription_plans where id='platform_plus_monthly'")).rows; const result={planDebug,runtime:'PGlite0.5.15 PostgreSQL WASM, full118 migrations with auth stubs; executing exact worker repository function transpiled via node stripTypeScriptTypes with tagged-SQL adapter to PGlite'};
try{
const first=await repo.leaseDueCollections({now:new Date('2026-11-04T00:00:00Z'),limit:10,maxAttempts:5,leaseDurationMs:120000});
const second=await repo.leaseDueCollections({now:new Date('2026-11-04T00:00:01Z'),limit:10,maxAttempts:5,leaseDurationMs:120000});
result.leases={first:first.length,second:second.length};
result.collections=(await db.query('select id,period_starts_at,state,attempt_count,idempotency_key,leased_until from subscription_collections order by period_starts_at')).rows;
result.subscription=(await db.query('select state,current_period_starts_at,current_period_ends_at,next_collection_at from subscriptions')).rows;
}catch(e){result.error={message:e.message,code:e.code,stack:e.stack?.slice(0,600)};}
fs.writeFileSync('/workspace/scratch/0635fbdaf32f/subscription-initial-period-proof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await db.close();

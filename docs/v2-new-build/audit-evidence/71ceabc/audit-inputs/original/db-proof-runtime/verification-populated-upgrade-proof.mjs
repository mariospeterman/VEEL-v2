import { PGlite } from './node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from './node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
import fs from 'node:fs';
const db=new PGlite({extensions:{pgcrypto}});
const root='/workspace/scratch/0635fbdaf32f';
const dir=root+'/wevid-complete/packages/database/migrations/';
const existingDefaultGrants=process.env.WEVID_AUDIT_EXISTING_SUPABASE_DEFAULTS==='1';
const result={runtime:'PGlite0.5.15 PostgreSQL WASM + pgcrypto; auth.uid/auth.jwt stubs; no hosted Supabase services',existingDefaultGrants,upgradeFailures:[]};
await db.exec(`create extension pgcrypto;create role anon;create role authenticated;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create publication supabase_realtime;`);
if(existingDefaultGrants)await db.exec('alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;');
const uid='00000000-0000-4000-8000-000000000001';
const pi='00000000-0000-4000-8000-000000000020';
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.endsWith('.down.sql')).sort()){
 if(f.startsWith('0046')) await db.exec(`insert into reports(id,reporter_user_id,subject_type,subject_id,reason,queue,state,idempotency_key)values(gen_random_uuid(),'${uid}','user','${uid}','test legacy report','user','dismissed','legacy-upgrade');`);
 if(f.startsWith('0056')) await db.exec(`
 insert into payment_intents(id,user_id,product_type,target_id,amount_minor,currency,idempotency_key,request_hash,solana_cluster,treasury_wallet,reference_address,expires_at)values('${pi}','${uid}','event_access_pass','${uid}',100,'SOL','legacy-pi','hash','devnet','treasury','reference',now()+interval '10 minutes');
 insert into events(id,creator_user_id,title,starts_at,location_type,idempotency_key,request_hash) values('00000000-0000-4000-8000-000000000030','${uid}','Legacy Event',now()+interval '1 day','physical','event-key','hash');
 insert into event_access_pass_types(id,event_id,label,price_minor,capacity)values('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000030','Entry',100,5);
 insert into event_access_purchase_requests(payment_intent_id,event_id,access_pass_type_id,buyer_user_id,amount_minor,state)values('${pi}','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000040','${uid}',100,'ticket_granted');`);
 if(f.startsWith('0077')) await db.exec(`insert into viewer_feed_preferences(user_id)values('${uid}');`);
 try{await db.exec(fs.readFileSync(dir+f,'utf8'));}
 catch(e){
  result.upgradeFailures.push({migration:f,code:e.code,message:e.message,detail:e.detail});
  if(f.startsWith('0046'))await db.exec('delete from reports');
  else if(f.startsWith('0056'))await db.exec(`delete from event_access_purchase_requests;delete from event_access_pass_types;delete from events;delete from payment_intents;`);
  else if(f.startsWith('0077'))await db.exec('delete from viewer_feed_preferences');
  else throw e;
  await db.exec(fs.readFileSync(dir+f,'utf8'));
 }
 if(f.startsWith('0001'))await db.exec(`insert into users(id,supabase_user_id)values('${uid}','${uid}');`);
}
result.finalSchemaVersion=118;
// The comments grant and unconditional visible policy remain in the effective schema.
await db.exec(`insert into content_items(id,creator_user_id,media_type,visibility)values('00000000-0000-4000-8000-000000000050','${uid}','text','private');
insert into comments(id,content_item_id,user_id,body,idempotency_key)values(gen_random_uuid(),'00000000-0000-4000-8000-000000000050','${uid}','private post conversation','comment-key');
grant usage on schema auth to authenticated;
set request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000077"}';set role authenticated;`);
try{result.privateCommentsRead=(await db.query('select content_item_id,body from comments')).rows;}
catch(e){result.privateCommentsReadError={code:e.code,message:e.message};}
await db.exec('reset role');
// Verify the current performer-status domain mismatch independently of provider HTTP behavior.
await db.exec(`insert into performer_subjects(id,owner_user_id,linked_user_id)values('00000000-0000-4000-8000-000000000060','${uid}','${uid}');`);
try{await db.exec(`insert into verification_records(subject_type,subject_id,purpose,status,provider,method,assurance_level)values('performer','00000000-0000-4000-8000-000000000060','performer_eligibility','invalid','sumsub','gov_id_selfie','documentary');`);result.invalidPerformerAccepted=true;}
catch(e){result.invalidPerformerError={code:e.code,message:e.message,detail:e.detail};}
fs.writeFileSync(root+(existingDefaultGrants?'/verification-db-existing-supabase-grants-proof.json':'/verification-db-populated-upgrade-proof.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
await db.close();

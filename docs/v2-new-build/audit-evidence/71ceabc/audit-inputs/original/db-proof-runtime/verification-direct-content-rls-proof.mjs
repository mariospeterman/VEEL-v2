import { PGlite } from './node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from './node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
import fs from 'node:fs';
const db=new PGlite({extensions:{pgcrypto}});
const result={runtime:'PGlite PostgreSQL WASM0.5.15, pgcrypto extension; auth.uid/auth.jwt stubbed from JWT setting; empty Supabase realtime publication; no hosted Supabase services',applied:[],errors:[]};
await db.exec(`create extension if not exists pgcrypto; create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create publication supabase_realtime;
`);
await db.exec('alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated;');
const dir='/workspace/scratch/0635fbdaf32f/wevid-complete/packages/database/migrations/';
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.endsWith('.down.sql')).sort()) {
 try{ await db.exec(fs.readFileSync(dir+f,'utf8')); result.applied.push(f); }
 catch(e){result.errors.push({file:f,code:e.code,message:e.message}); break;}
}

const uid='00000000-0000-4000-8000-000000000001';
const cid='00000000-0000-4000-8000-000000000090';
await db.exec(`insert into users(id,supabase_user_id,state)values('${uid}','${uid}','active');
insert into content_items(id,creator_user_id,media_type,state,caption,visibility,nsfw_label,moderation_state,publish_state,created_at,published_at,distribution_mode,expires_at)
values('${cid}','${uid}','image','ready','expired-adult-fixture-caption','public','adult','pending','submitted_for_review',now()-interval '3 days',now()-interval '2 days','moment',now()-interval '1 day');
insert into media_assets(id,content_item_id,provider,provider_asset_id,provider_state,asset_kind,position,provider_playable,ready_at)
values('00000000-0000-4000-8000-000000000091','${cid}','bunny','private-provider-asset-fixture','ready','image',0,true,now());
insert into verification_records(subject_type,subject_id,purpose,status,provider,method,assurance_level,threshold_age,result_over_threshold,policy_version,terms_accepted_at,verified_at)
values('user','${uid}','adult_publisher_eligibility','valid','internal','manual_review','high',18,true,'fixture-v1',now(),now());
insert into content_safety_declarations(content_item_id,uploader_user_id,representation_mode,policy_version,state,accepted_at)
values('${cid}','${uid}','no_real_person','fixture-v1','active',now());
insert into media_safety_cases(id,content_item_id,declared_rating,state,decision_source,reason_code,policy_version,provider_release_allowed,decided_at)
values('00000000-0000-4000-8000-000000000092','${cid}','adult','approved','staff','fixture_approved','fixture-v1',true,now());
insert into provider_media_scan_events(media_safety_case_id,media_asset_id,provider,provider_event_id,scan_type,normalized_signal,payload_hash,model_or_ruleset_version,observed_at)
select '00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000091',provider,'fixture:'||scan_type,scan_type,'clear',repeat('a',64),'fixture-v1',now()
from (values ('bunny_stream','container_integrity'),('bunny_shield','malware'),('bunny_shield','known_hash'),('internal','content_classification'),('internal','manual_review')) as facts(provider,scan_type);
update content_items set moderation_state='approved',publish_state='published' where id='${cid}';
`);
result.seededReleaseReady=(await db.query(`select private.content_safety_release_ready('${cid}') as ready`)).rows;
await db.exec(`grant usage on schema auth to authenticated;
set request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000077"}';set role authenticated;`);
result.unlinkedCurrentUser=(await db.query('select private.current_app_user_id() as uid,private.has_protected_app_access() as protected')).rows;
result.directExpiredAdultContent=(await db.query('select id,caption,nsfw_label,distribution_mode,expires_at from content_items')).rows;
result.directMediaReferences=(await db.query('select content_item_id,provider,provider_asset_id from media_assets')).rows;
result.scope='All 118 exact migrations, existing-public-table default grants installed before replay; administrator seeds an expired adult Moment through all final-schema release predicates using synthetic normalized scan/consent/age facts; no triggers disabled. No upload/moderation/provider workflow or delivery URL tested.';
fs.writeFileSync('/workspace/scratch/0635fbdaf32f/verification-direct-content-rls-proof.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({scope:result.scope,applied:result.applied.length,errors:result.errors,seededReleaseReady:result.seededReleaseReady,unlinkedCurrentUser:result.unlinkedCurrentUser,directExpiredAdultContent:result.directExpiredAdultContent,directMediaReferences:result.directMediaReferences},null,2));
await db.close();

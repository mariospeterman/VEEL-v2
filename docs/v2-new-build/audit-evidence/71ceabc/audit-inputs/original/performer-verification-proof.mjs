import { PGlite } from './db-proof-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create schema private;
create table performer_subjects(id uuid primary key, verification_status text,verification_provider text,verification_reference text,verification_method text,assurance_level text,result_over_18 boolean,verified_at timestamptz,expires_at timestamptz,source_verification_record_id uuid,updated_at timestamptz);
create table verification_records(id uuid primary key,subject_type text,subject_id uuid,purpose text,status text,provider text,provider_reference text,method text,assurance_level text,threshold_age integer,result_over_threshold boolean,verified_at timestamptz,expires_at timestamptz);
insert into performer_subjects(id,verification_status)values('00000000-0000-0000-0000-000000000001','pending');`);
const source=await readFile('/workspace/scratch/0635fbdaf32f/wevid-audit/packages/database/migrations/0090_monetisation_performer_enterprise_authorities.sql','utf8');
const start=source.indexOf('create or replace function private.sync_performer_verification_record()');
const end=source.indexOf('create or replace function private.bump_content_performer_revision()',start);
assert.ok(start>=0&&end>start);
await db.exec(source.slice(start,end));
// Match the webhook insert's relevant field list; threshold fields are omitted in production.
await db.exec(`insert into verification_records(id,subject_type,subject_id,purpose,status,provider,provider_reference,method,assurance_level,verified_at,expires_at)
values('00000000-0000-0000-0000-000000000002','performer','00000000-0000-0000-0000-000000000001','performer_eligibility','valid','didit','provider-session','gov_id_selfie','documentary',now(),now()+interval '1 day');`);
const rows=(await db.query(`select verification_status,result_over_18,result_over_18 is true as satisfies_age_readiness from performer_subjects`)).rows;
assert.equal(rows[0].verification_status,'valid');assert.equal(rows[0].result_over_18,null);assert.equal(rows[0].satisfies_age_readiness,false);
const result={engine:'PGlite PostgreSQL',scope:'Exact performer synchronization function/trigger from0090; reduced schema with production nullable age fields; webhook relevant insert field list as in verification-repository357-370',rows,verdict:'Provider approval marks performer valid while leaving required over18 evidence null; canonical publication age predicate fails.'};
await writeFile('/workspace/scratch/0635fbdaf32f/performer-verification-proof.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));await db.close();

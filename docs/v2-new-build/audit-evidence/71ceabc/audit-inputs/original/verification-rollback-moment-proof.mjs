import { PGlite } from './db-proof-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema private;
create table users(id uuid primary key);
create table content_items (
 id uuid primary key,
 creator_user_id uuid not null references users(id),
 publish_state text not null,
 media_type text not null,
 created_at timestamptz not null,
 published_at timestamptz,
 constraint content_items_publish_state_check check(publish_state in ('draft','submitted_for_review','published','blocked','unpublished'))
);
create function private.eligible_content(p_viewer_user_id uuid,p_content_preference text default null)
returns table(content_item_id uuid) language sql stable as $$
 select id from content_items where publish_state='published'
$$;
insert into users values ('00000000-0000-0000-0000-000000000001');
`);
const repo = '/workspace/scratch/0635fbdaf32f/wevid-complete';
await db.exec(await readFile(repo+'/packages/database/migrations/0117_moments_and_scheduled_publication.sql','utf8'));
await db.exec(`insert into content_items(id,creator_user_id,publish_state,media_type,created_at,published_at,distribution_mode,expires_at)
 values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','published','image',now()-interval '3 days',now()-interval '2 days','moment',now()-interval '1 day');`);
const before = (await db.query(`select * from private.eligible_content('00000000-0000-0000-0000-000000000001')`)).rows;
await db.exec(await readFile(repo+'/packages/database/migrations/0117_moments_and_scheduled_publication.down.sql','utf8'));
const after = (await db.query(`select * from private.eligible_content('00000000-0000-0000-0000-000000000001')`)).rows;
const columns = (await db.query(`select column_name from information_schema.columns where table_name='content_items' and column_name in ('distribution_mode','expires_at')`)).rows;
assert.equal(before.length,0); assert.equal(after.length,1); assert.equal(columns.length,0);
const result={engine:'PGlite PostgreSQL',scope:'Exact unmodified migration 0117 up/down on reduced base schema. Base eligibility fixture models already-eligible published content; it does not duplicate moderation/access implementation.',expiredMomentVisibilityBeforeRollback:before,expiredMomentVisibilityAfterRollback:after,preservedMomentExpiryColumns:columns,verdict:'Expired moment resurrects as published eligible content; expiry metadata is destroyed.'};
await writeFile('/workspace/scratch/0635fbdaf32f/verification-rollback-moment-proof.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
await db.close();

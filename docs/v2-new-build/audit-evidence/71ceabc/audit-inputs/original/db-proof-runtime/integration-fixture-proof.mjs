import { PGlite } from './node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from './node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
import fs from 'node:fs';
const db = new PGlite({ extensions: { pgcrypto } });
const result = {runtime:'PGlite 0.5.15 PostgreSQL WASM; pgcrypto; auth functions and realtime publication compatibility bootstrap; not hosted Supabase/provider integration', migrationCount:0, fixtureResults:[]};
await db.exec(`create extension if not exists pgcrypto; create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create publication supabase_realtime;`);
const dir='/workspace/scratch/0635fbdaf32f/wevid-audit/packages/database/migrations/';
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&!f.endsWith('.down.sql')).sort()) {await db.exec(fs.readFileSync(dir+f,'utf8'));result.migrationCount++;}
for(const fixture of [
 {name:'current Didit distinct identity fixture',id:'71717171-7171-4171-8171-717171717171',supabaseId:'72727272-7272-4272-8272-727272727272'},
 {name:'canonical equal identity fixture',id:'73737373-7373-4373-8373-737373737373',supabaseId:'73737373-7373-4373-8373-737373737373'},
 {name:'canonical provider-independent identity fixture',id:'74747474-7474-4474-8474-747474747474',supabaseId:null}
]) {
 try {await db.query('insert into users(id,supabase_user_id) values($1,$2)',[fixture.id,fixture.supabaseId]);result.fixtureResults.push({...fixture,insert:'success'});}
 catch(e) {result.fixtureResults.push({...fixture,insert:'rejected',code:e.code,constraint:e.constraint,message:e.message});}
}
fs.writeFileSync('/workspace/scratch/0635fbdaf32f/integration-fixture-proof.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));await db.close();
